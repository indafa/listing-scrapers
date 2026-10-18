// کار enrich (هر ۳۰ دقیقه): برای آگهی‌های اخیرِ بدون ویژگی (یا تغییرکرده) ویژگی‌های دست‌دوم را استخراج می‌کند
// و آگهی را به کاتالوگ وصل می‌کند. فقط قواعد قطعی؛ هیچ AI در Actions نیست.
//
// قرارداد با Worker (ستون‌ها از schema.sql):
//   listing_features.match_method:
//     'auto'      تطبیق قطعی (امتیاز ≥ ۰٫۸۵، غیرمشکوک، فاصله ≥ ۰٫۰۵ با نفر دوم) — model_id پر می‌شود
//     'verify'    امتیاز ۰٫۶ تا ۰٫۸۵ (یا مشکوک/مبهم) — model_id خالی؛ منتظر تطبیق‌دهنده‌ی AI در Worker
//     'unmatched' امتیاز زیر ۰٫۶ — model_id خالی؛ صف بررسی دستی
//     (Worker مقدارهای 'ai' و 'admin' را می‌نویسد؛ enrich آن‌ها را بازنویسی نمی‌کند)
//   unmatched_queue: برای هر متن یکتا (text_norm) یک ردیف؛ status='open' (بی‌تطبیق) یا 'verify' (منتظر AI).
//   ردیف 'verify' که بعد از ۲۴ ساعت حل نشود به 'open' می‌رود تا به مدیر برسد.
import {
  extractFeatures, excludedReason, DEFAULT_WEIGHTS, parseQuery, rank, nameTokens, candidateTokenSet,
  variantKey, normFa,
} from '../shared/core/core.mjs';
import {
  chunk, placeholders, isoAgo, sha1, parseJsonArray, getSettings, upsertMany, insertIgnoreMany, runJob, isMain, HOUR,
} from '../shared/job-utils.mjs';

export const FEATURES_VERSION = 'f1';
const STORAGES = new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);
const RECHECK_UNRESOLVED_HOURS = 6;
const VERIFY_TTL_HOURS = 24;
const WORKER_METHODS = new Set(['ai', 'admin', 'manual', 'alias']);
// ⚠️ \b در جاوااسکریپت فقط کنار نویسه‌های لاتین کار می‌کند و بعد از واژه‌ی فارسی هرگز مرز نمی‌بیند؛
// برای همین مرز واژه را صریح با lookahead (فاصله/علامت/پایان متن) می‌نویسیم. (تست: tests/enrich.test.mjs)
const ACCESSORY_RE = /^(قاب|کاور|گلس|محافظ|شارژر|کابل|هندزفری|هدفون|هدست|ایرپاد|پاوربانک|پاور بانک|کیف|پایه|استند|ساعت هوشمند|مچ بند|ال ?سی ?دی|تاچ|مادربرد|برد|قطعه|فلت|درب پشت|باتری)(?=[^\p{L}\p{N}]|$)/u;
// برچسب‌های «بدون اطلاعات» که منبع برای برند/مدل می‌گذارد؛ متن مفیدی برای تطبیق یا صف بررسی نیستند.
export const OTHER_LABELS = new Set(['', 'سایر', 'other', 'متفرقه', 'نامشخص']);
export const isAccessoryTitle = (title) => ACCESSORY_RE.test(normFa(title || ''));
const usable = (v) => { const t = String(v ?? '').trim(); return OTHER_LABELS.has(t.toLowerCase()) ? '' : t; };

export const FEATURE_COLUMNS = [
  'token', 'model_id', 'variant_key', 'storage_gb', 'ram_gb', 'color', 'cond_class', 'battery_pct', 'flags', 'repairs',
  'score', 'conf', 'match_score', 'match_method', 'excluded', 'desc_hash', 'features_at',
];

// ── ورودی‌های ساختاریافته ───────────────────────────────────────────────────
export function storageFromField(v) {
  let n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if ([1, 2, 4].includes(n)) n *= 1024; // «۱ ترابایت» توسط پارسر به عدد ۱ تبدیل می‌شود
  return STORAGES.has(n) ? n : null;
}
export function ramFromField(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : null;
}
const canonColor = (s) => (s ? parseQuery(String(s)).color : null);

// ── کاتالوگ در حافظه (همان منطق GROUP BY کوئری Worker: market/candidates.ts) ──
function rowToCandidate(r) {
  return {
    model_id: r.model_id,
    brand: r.brand,
    name_tokens: nameTokens(`${r.brand} ${r.name}`),
    alias_tokens: parseJsonArray(r.alias_tokens),
    storages: parseJsonArray(r.storages),
    rams: parseJsonArray(r.rams),
    colors: parseJsonArray(r.colors),
  };
}

export async function loadCatalogIndex(d1) {
  const cat = await d1.query('SELECT model_id, brand, name, alias_tokens, storages, rams, colors FROM device_catalog');
  const toks = await d1.query('SELECT token, model_id FROM model_tokens');
  const models = new Map(cat.map((r) => [r.model_id, rowToCandidate(r)]));
  const byToken = new Map();
  for (const t of toks) {
    if (!models.has(t.model_id)) continue;
    if (!byToken.has(t.token)) byToken.set(t.token, new Set());
    byToken.get(t.token).add(t.model_id);
  }
  return { models, byToken };
}

/** حداکثر `limit` مدل با بیشترین توکن مشترک (ترتیب: برخورد کاهشی، model_id صعودی) */
export function findCandidatesLocal(index, tokens, limit = 12, brand = null) {
  const toks = [...new Set(tokens.filter((t) => t && t.length <= 40))].slice(0, 30);
  if (!toks.length) return [];
  const hits = new Map();
  for (const t of toks) for (const id of index.byToken.get(t) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
  let ids = [...hits.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, brand ? limit * 3 : limit)
    .map(([id]) => id);
  if (brand) ids = ids.filter((id) => id.startsWith(brand + '_')).slice(0, limit);
  return ids.map((id) => index.models.get(id)).filter(Boolean);
}

// ── تطبیق یک آگهی ───────────────────────────────────────────────────────────
function decide(text, storageField, ramField, index) {
  const q = parseQuery(text);
  if (!q.modelTokens.length) return null;
  if (storageField) q.storageGb = storageField;
  if (ramField) q.ramGb = ramField;
  const cands = findCandidatesLocal(index, q.modelTokens, 12, q.brand);
  const d = rank(q, cands);
  return { q, d, text };
}

export function matchListing(row, index) {
  const storage = storageFromField(row.internal_storage);
  const ram = ramFromField(row.ram);
  const primaryText = `${usable(row.manufacturer)} ${usable(row.brand_model)}`.trim();
  const a = primaryText ? decide(primaryText, storage, ram, index) : null;
  const b = row.title ? decide(String(row.title), storage, ram, index) : null;
  let pick = a ?? b;
  let kind;
  if (a && a.d.kind === 'auto') {
    pick = a;
    kind = 'auto';
    // عنوان آگهی مدل دیگری را قطعی نشان می‌دهد: تعارض، پس تایید لازم است
    if (b && b.d.kind === 'auto' && b.d.best.model_id !== a.d.best.model_id) kind = 'verify';
  } else if (a && b) {
    const sa = a.d.best?.score ?? 0;
    const sb = b.d.best?.score ?? 0;
    pick = sb > sa ? b : a;
    kind = pick.d.kind;
  } else if (pick) {
    kind = pick.d.kind;
  } else {
    return { kind: 'unmatched', best: null, top: [], q: null, text: primaryText || String(row.title || '') };
  }
  if (kind === 'ambiguous') kind = 'verify';
  return { kind, best: pick.d.best ?? null, top: pick.d.top, q: pick.q, text: pick.text };
}

async function loadWeights(d1) {
  const s = await getSettings(d1, ['valuation_weights']);
  const w = { ...DEFAULT_WEIGHTS };
  if (!s.valuation_weights) return w;
  try {
    const parsed = JSON.parse(s.valuation_weights);
    for (const k of Object.keys(DEFAULT_WEIGHTS)) if (Number.isFinite(Number(parsed?.[k]))) w[k] = Number(parsed[k]);
  } catch { /* مقدار نامعتبر: پیش‌فرض */ }
  return w;
}

const SELECT_SQL = `
SELECT l.token, l.title, l.category, l.brand_model, l.manufacturer, l.description, l.device_condition, l.battery_health,
       l.body_condition, l.screen_condition, l.camera_condition, l.box_status, l.originality, l.internal_storage, l.ram, l.color,
       f.token AS f_token, f.desc_hash AS f_hash, f.model_id AS f_model, f.match_method AS f_method,
       f.match_score AS f_score, f.features_at AS f_at
FROM listings l LEFT JOIN listing_features f ON f.token = l.token
WHERE l.first_seen >= ? AND (
  f.token IS NULL OR f.features_at IS NULL
  OR l.last_seen > strftime('%Y-%m-%dT%H:%M:%fZ', f.features_at / 1000.0, 'unixepoch')
  OR (f.match_method IN ('unmatched', 'verify') AND f.features_at < ?)
)
ORDER BY (f.token IS NULL) DESC, l.last_seen DESC
LIMIT ?`;

export async function runEnrich({ d1, now = Date.now(), log = console.log, limit = 600, recentHours = 96 } = {}) {
  const sum = { examined: 0, auto: 0, verify: 0, unmatched: 0, unchanged: 0, written: 0, failed: 0, excluded: 0, queued: 0, demoted: 0 };

  // ردیف‌های verify که Worker تا ۲۴ ساعت حل نکرده، به صف بررسی دستی می‌روند
  const ttl = await d1.exec(
    "UPDATE unmatched_queue SET status = 'open' WHERE source = 'listing' AND status = 'verify' AND created_at < ?",
    [now - VERIFY_TTL_HOURS * HOUR]
  );
  sum.demoted = Number(ttl.meta?.changes || 0);

  const rows = await d1.query(SELECT_SQL, [isoAgo(now, recentHours), now - RECHECK_UNRESOLVED_HOURS * HOUR, limit]);
  sum.examined = rows.length;
  if (!rows.length) {
    log(`✅ enrich — چیزی برای پردازش نبود | حل‌نشده‌ی منتقل‌شده به صف دستی ${sum.demoted}`);
    return sum;
  }

  const [weights, index] = await Promise.all([loadWeights(d1), loadCatalogIndex(d1)]);
  if (index.models.size === 0) log('ℹ️  کاتالوگ خالی است؛ همه‌چیز «بی‌تطبیق» می‌شود تا کار catalog اجرا شود.');

  const featureRows = [];
  const logRows = [];
  const queueCandidates = []; // { token, text_norm, text, kind, top }
  const resolvedTokens = [];

  for (const r of rows) {
    const f = extractFeatures(
      {
        title: r.title, description: r.description, device_condition: r.device_condition, battery_health: r.battery_health,
        body_condition: r.body_condition, screen_condition: r.screen_condition, camera_condition: r.camera_condition,
        box_status: r.box_status, originality: r.originality,
      },
      weights
    );
    let excluded = excludedReason(f);
    if (!excluded && isAccessoryTitle(r.title)) excluded = 'accessory';
    if (excluded) sum.excluded++;

    const hash = sha1(JSON.stringify([
      FEATURES_VERSION, weights, r.title, r.description, r.device_condition, r.battery_health, r.body_condition,
      r.screen_condition, r.camera_condition, r.box_status, r.originality, r.brand_model, r.manufacturer,
      r.internal_storage, r.ram, r.color, r.category,
    ]));

    const had = r.f_token != null;
    const unresolved = r.f_method === 'unmatched' || r.f_method === 'verify';
    const workerOwned = WORKER_METHODS.has(r.f_method);
    const hashChanged = !had || r.f_hash !== hash;

    // آگهی‌ای که فقط به‌خاطر تازه‌شدن last_seen دوباره انتخاب شده و چیزی تغییر نکرده
    if (had && !hashChanged && !(unresolved && now - Number(r.f_at || 0) >= RECHECK_UNRESOLVED_HOURS * HOUR)) {
      sum.unchanged++;
      continue;
    }

    const storageField = storageFromField(r.internal_storage);
    const ramField = ramFromField(r.ram);
    let m;
    if (workerOwned) m = { kind: r.f_method, best: { model_id: r.f_model, score: r.f_score }, top: [], q: null, text: '' };
    else m = matchListing(r, index);

    const q = m.q;
    const storage = storageField ?? q?.storageGb ?? 0;
    const ram = ramField ?? q?.ramGb ?? 0;
    const color = canonColor(r.color) || q?.color || '';
    const isAuto = m.kind === 'auto';
    const keepModel = workerOwned ? r.f_model : isAuto ? m.best.model_id : null;

    featureRows.push({
      token: r.token,
      model_id: keepModel,
      variant_key: keepModel ? variantKey(keepModel, storage || null, color || null) : null,
      storage_gb: storage || 0,
      ram_gb: ram || 0,
      color,
      cond_class: f.cond_class,
      battery_pct: f.battery_pct,
      flags: JSON.stringify(f.flags),
      repairs: JSON.stringify(f.repairs),
      score: f.score,
      conf: f.conf,
      match_score: workerOwned ? r.f_score : m.best?.score ?? 0,
      match_method: m.kind,
      excluded,
      desc_hash: hash,
      features_at: now,
    });

    if (!workerOwned) {
      sum[m.kind]++;
      const changedDecision = !had || r.f_method !== m.kind || (isAuto && r.f_model !== m.best.model_id);
      if (changedDecision) {
        logRows.push({
          source: 'listing', ref: r.token, input_norm: (q?.norm ?? normFa(m.text)).slice(0, 200),
          model_id: isAuto ? m.best.model_id : null, score: m.best?.score ?? 0, method: m.kind, at: now,
        });
      }
      if (isAuto && unresolved) resolvedTokens.push(r.token);
      if (!isAuto) {
        queueCandidates.push({
          token: r.token, text: String(m.text || r.title || '').slice(0, 200),
          text_norm: (q?.norm || normFa(m.text || r.title || '')).slice(0, 200), kind: m.kind, top: m.top,
        });
      }
    }
  }

  // ── نوشتن ───────────────────────────────────────────────────────────────
  const w = await upsertMany(d1, { table: 'listing_features', columns: FEATURE_COLUMNS, rows: featureRows, conflict: 'token' });
  sum.written = w.written;
  sum.failed = w.failed;
  if (w.failed) console.error(`⚠️  ${w.failed} ردیف ویژگی ذخیره نشد: ${w.errors[0]}`);

  if (logRows.length) await insertIgnoreMany(d1, {
    table: 'match_log', columns: ['source', 'ref', 'input_norm', 'model_id', 'score', 'method', 'at'], rows: logRows,
  });

  // صف بررسی: هر متن یکتا فقط یک‌بار (در هر وضعیتی که قبلاً ثبت شده باشد دوباره نمی‌آید)
  if (queueCandidates.length) {
    const byNorm = new Map();
    for (const c of queueCandidates) if (c.text_norm && !byNorm.has(c.text_norm)) byNorm.set(c.text_norm, c);
    const norms = [...byNorm.keys()];
    const existing = new Set();
    for (const part of chunk(norms)) {
      const got = await d1.query(
        `SELECT text_norm FROM unmatched_queue WHERE source = 'listing' AND text_norm IN (${placeholders(part.length)})`, part
      );
      for (const g of got) existing.add(g.text_norm);
    }
    const fresh = norms.filter((n) => !existing.has(n)).map((n) => {
      const c = byNorm.get(n);
      return {
        source: 'listing', ref: c.token, text: c.text, text_norm: n,
        candidates: JSON.stringify(c.top.map((t) => ({ model_id: t.model_id, score: t.score, suspicious: t.suspicious }))),
        status: c.kind === 'verify' ? 'verify' : 'open', created_at: now,
      };
    });
    await insertIgnoreMany(d1, {
      table: 'unmatched_queue', columns: ['source', 'ref', 'text', 'text_norm', 'candidates', 'status', 'created_at'], rows: fresh,
    });
    sum.queued = fresh.length;
  }

  for (const part of chunk(resolvedTokens)) {
    await d1.query(
      `UPDATE unmatched_queue SET status = 'resolved' WHERE source = 'listing' AND status IN ('open', 'verify') AND ref IN (${placeholders(part.length)})`,
      part
    );
  }

  log(
    `✅ enrich — بررسی‌شده ${sum.examined} | تطبیق خودکار ${sum.auto} | نیازمند تایید ${sum.verify} | بی‌تطبیق ${sum.unmatched} | ` +
    `بدون تغییر ${sum.unchanged} | نوشته‌شده ${sum.written} | کنارگذاشته‌شده از آمار ${sum.excluded} | صف بررسی ${sum.queued}`
  );
  return sum;
}

if (isMain(import.meta.url)) await runJob('enrich', (ctx) => runEnrich(ctx));
