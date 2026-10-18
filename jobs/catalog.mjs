// کار catalog (روزانه): ساخت/به‌روزرسانی device_catalog و model_tokens از brand_model آگهی‌های مشاهده‌شده.
//
//  • مدل جدید فقط وقتی ساخته می‌شود که دست‌کم CATALOG_MIN_LISTINGS (پیش‌فرض ۲) آگهی داشته باشد
//    (۳ آگهی وقتی نام از عنوان آگهی درآمده) تا غلط‌های املایی تکی وارد کاتالوگ نشوند.
//  • مدل‌های source='manual' یا 'external' هیچ‌وقت بازنویسی نمی‌شوند؛ فقط توکن‌هایشان کامل می‌شود.
//  • حافظه/رم/رنگ‌های مشاهده‌شده به فهرست مدل اضافه می‌شود (هیچ‌وقت کم نمی‌شود).
//  • منبع خارجی (CATALOG_SOURCE_BASE یا تنظیم catalog_source_base) اختیاری است و خطایش فقط هشدار می‌دهد.
//    ⚠️ ساختار منبع خارجی راستی‌آزمایی نشده؛ فقط JSON (آرایه) و متن ساده (هر خط یک مدل) پشتیبانی می‌شود.
import {
  parseQuery, inferBrand, modelIdFrom, nameTokens, candidateTokenSet, normFa, TIER,
} from '../shared/core/core.mjs';
import { isoAgo, parseJsonArray, getSettings, upsertMany, insertIgnoreMany, runJob, isMain } from '../shared/job-utils.mjs';
import { storageFromField, ramFromField, OTHER_LABELS, isAccessoryTitle } from './enrich.mjs';

const WINDOW_DAYS = 120;
// برچسب‌های «بدون اطلاعات» از enrich.mjs می‌آید (OTHER_LABELS)
const SHORT_UPPER = new Set(['fe', 'se', 'gt', 'xr', 'xs']);

export const CATALOG_COLUMNS = [
  'model_id', 'brand', 'name', 'name_norm', 'alias_tokens', 'type', 'year', 'storages', 'rams', 'colors', 'specs',
  'source', 'verified', 'created_at', 'updated_at',
];

/** نام نمایشی از توکن‌های کانونیک: ['galaxy','a','54'] → «Galaxy A54» */
export function prettyName(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[a-z]{1,2}$/.test(t) && !TIER.has(t) && /^\d+$/.test(tokens[i + 1] ?? '')) { out.push(t.toUpperCase() + tokens[i + 1]); i++; continue; }
    // «13 t» → «13T»، «12 c» → «12C» (پسوند تک‌حرفی بعد از عدد)
    if (/^\d+$/.test(t) && /^[a-z]$/.test(tokens[i + 1] ?? '') && !TIER.has(tokens[i + 1])) { out.push(t + tokens[i + 1].toUpperCase()); i++; continue; }
    if (t === 'iphone') out.push('iPhone');
    else if (t === 'ipad') out.push('iPad');
    else if (SHORT_UPPER.has(t)) out.push(t.toUpperCase());
    else if (/^[a-z]/.test(t)) out.push(t[0].toUpperCase() + t.slice(1));
    else out.push(t);
  }
  return out.join(' ');
}

/** یک متن مدل را به { brand, tokens, model_id, name } تبدیل می‌کند؛ اگر برند/توکن نداشت null */
export function describeModel(text, hintBrand = null) {
  const q = parseQuery(text);
  const brand = hintBrand || q.brand || inferBrand(text);
  if (!brand || !q.modelTokens.length) return null;
  const model_id = modelIdFrom(brand, q.modelTokens.join(' '));
  if (model_id === `${brand}_`) return null;
  return { brand, tokens: q.modelTokens, model_id, name: prettyName(q.modelTokens) };
}

const hasModelHint = (tokens) => tokens.some((t) => /\d/.test(t) || TIER.has(t));

const SELECT_SQL = `
SELECT brand_model, CASE WHEN brand_model IS NULL OR LOWER(brand_model) IN ('', 'سایر', 'other', 'متفرقه', 'نامشخص') THEN title ELSE '' END AS alt_title,
       category, internal_storage, ram, color, COUNT(*) AS c
FROM listings WHERE first_seen >= ?
GROUP BY brand_model, alt_title, category, internal_storage, ram, color`;

export function aggregateObserved(rows, { minListings = 2 } = {}) {
  const models = new Map();
  let noBrand = 0;
  for (const r of rows) {
    const bm = String(r.brand_model ?? '').trim();
    const fromTitle = OTHER_LABELS.has(bm.toLowerCase());
    const text = fromTitle ? String(r.alt_title ?? '').trim() : bm;
    if (!text) continue;
    if (fromTitle && isAccessoryTitle(text)) continue; // «قاب فلان» مدل جدید نمی‌سازد
    const d = describeModel(text);
    if (!d) { noBrand += Number(r.c) || 1; continue; }
    if (fromTitle && !hasModelHint(d.tokens)) continue;
    let m = models.get(d.model_id);
    if (!m) { m = { ...d, count: 0, titleCount: 0, tablet: 0, phone: 0, storages: new Map(), rams: new Map(), colors: new Map() }; models.set(d.model_id, m); }
    const c = Number(r.c) || 1;
    m.count += c;
    if (fromTitle) m.titleCount += c;
    if (r.category === 'tablet') m.tablet += c; else m.phone += c;
    const st = storageFromField(r.internal_storage); if (st) m.storages.set(st, (m.storages.get(st) ?? 0) + c);
    const rm = ramFromField(r.ram); if (rm) m.rams.set(rm, (m.rams.get(rm) ?? 0) + c);
    const col = r.color ? parseQuery(String(r.color)).color : null; if (col) m.colors.set(col, (m.colors.get(col) ?? 0) + c);
  }
  for (const [id, m] of models) {
    const need = m.titleCount === m.count ? Math.max(3, minListings) : minListings;
    if (m.count < need) models.delete(id);
  }
  return { models, noBrand };
}

const topKeys = (map, minObs) => [...map.entries()].filter(([, c]) => c >= minObs).map(([k]) => k);
const union = (a, b) => [...new Set([...a, ...b])];
const sortNum = (xs) => [...xs].sort((a, b) => a - b);

// ── منبع خارجی (اختیاری) ──────────────────────────────────────────────────
export function parseExternalList(text) {
  const t = String(text ?? '').slice(0, 2_000_000);
  if (/<html|<!doctype/i.test(t.slice(0, 500))) return { items: [], unsupported: true };
  try {
    const v = JSON.parse(t);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.models) ? v.models : Array.isArray(v?.items) ? v.items : Array.isArray(v?.data) ? v.data : [];
    const items = arr.map((x) => (typeof x === 'string' ? { name: x } : { name: x?.name ?? x?.title ?? x?.model, brand: x?.brand, year: x?.year, type: x?.type, storages: x?.storages, rams: x?.rams, colors: x?.colors }))
      .filter((x) => typeof x.name === 'string' && x.name.trim());
    return { items, unsupported: false };
  } catch { /* متن ساده */ }
  const items = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.length <= 80 && !l.startsWith('#')).map((name) => ({ name }));
  return { items, unsupported: false };
}

async function fetchExternal(base, log) {
  if (!/^https:\/\//i.test(base)) { log('⚠️  CATALOG_SOURCE_BASE باید با https:// شروع شود؛ نادیده گرفته شد.'); return []; }
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json, text/plain' } });
    if (!res.ok) { log(`⚠️  منبع خارجی کاتالوگ پاسخ ${res.status} داد؛ نادیده گرفته شد.`); return []; }
    const { items, unsupported } = parseExternalList(await res.text());
    if (unsupported) log('⚠️  منبع خارجی کاتالوگ صفحه‌ی HTML داد؛ فقط JSON یا متن ساده پشتیبانی می‌شود. نادیده گرفته شد.');
    return items.slice(0, 500);
  } catch (e) {
    log(`⚠️  منبع خارجی کاتالوگ در دسترس نبود (${String(e?.message ?? e).slice(0, 80)}) — این بخش رد شد.`);
    return [];
  }
}

export async function runCatalog({ d1, now = Date.now(), log = console.log, env = process.env, minListings } = {}) {
  const min = minListings ?? Number(env.CATALOG_MIN_LISTINGS || 2);
  const sum = { observed: 0, created: 0, updated: 0, tokensAdded: 0, external: 0, noBrand: 0 };

  const rows = await d1.query(SELECT_SQL, [isoAgo(now, WINDOW_DAYS * 24)]);
  const { models, noBrand } = aggregateObserved(rows, { minListings: min });
  sum.observed = models.size;
  sum.noBrand = noBrand;

  const cat = await d1.query('SELECT model_id, brand, name, alias_tokens, storages, rams, colors, source FROM device_catalog');
  const byId = new Map(cat.map((r) => [r.model_id, r]));

  const toWrite = [];
  for (const m of models.values()) {
    const obsStorages = topKeys(m.storages, 2); const obsRams = topKeys(m.rams, 2); const obsColors = topKeys(m.colors, 2);
    const ex = byId.get(m.model_id);
    if (!ex) {
      const row = {
        model_id: m.model_id, brand: m.brand, name: m.name, name_norm: nameTokens(m.name).join(' '), alias_tokens: '[]',
        type: m.tablet > m.phone || m.tokens.includes('ipad') ? 'tablet' : 'phone', year: null,
        storages: JSON.stringify(sortNum(obsStorages)), rams: JSON.stringify(sortNum(obsRams)), colors: JSON.stringify(obsColors.sort()),
        specs: null, source: 'observed', verified: 0, created_at: now, updated_at: now,
      };
      toWrite.push(row);
      byId.set(m.model_id, { ...row });
      sum.created++;
    } else if (ex.source === 'observed') {
      const st = sortNum(union(parseJsonArray(ex.storages), obsStorages));
      const rm = sortNum(union(parseJsonArray(ex.rams), obsRams));
      const co = union(parseJsonArray(ex.colors), obsColors).sort();
      const changed = JSON.stringify(st) !== JSON.stringify(parseJsonArray(ex.storages))
        || JSON.stringify(rm) !== JSON.stringify(parseJsonArray(ex.rams)) || JSON.stringify(co) !== JSON.stringify(parseJsonArray(ex.colors).slice().sort());
      if (changed) {
        const row = { ...ex, storages: JSON.stringify(st), rams: JSON.stringify(rm), colors: JSON.stringify(co), updated_at: now };
        toWrite.push({ model_id: ex.model_id, brand: ex.brand, name: ex.name, name_norm: nameTokens(ex.name).join(' '), alias_tokens: ex.alias_tokens ?? '[]',
          type: 'phone', year: null, storages: row.storages, rams: row.rams, colors: row.colors, specs: null, source: 'observed', verified: 0, created_at: now, updated_at: now });
        Object.assign(ex, { storages: row.storages, rams: row.rams, colors: row.colors });
        sum.updated++;
      }
    }
  }

  // منبع خارجی اختیاری: فقط مدل‌هایی که هنوز در کاتالوگ نیستند
  const settings = await getSettings(d1, ['catalog_source_base']);
  const extBase = String(env.CATALOG_SOURCE_BASE || settings.catalog_source_base || '').trim();
  if (extBase) {
    for (const it of await fetchExternal(extBase, log)) {
      const d = describeModel(`${it.brand ?? ''} ${it.name}`.trim(), it.brand ? inferBrand(String(it.brand)) : null);
      if (!d || byId.has(d.model_id)) continue;
      const num = (xs, f) => (Array.isArray(xs) ? xs.map(f).filter(Boolean) : []);
      const row = {
        model_id: d.model_id, brand: d.brand, name: d.name, name_norm: nameTokens(d.name).join(' '), alias_tokens: '[]',
        type: it.type === 'tablet' || d.tokens.includes('ipad') ? 'tablet' : 'phone',
        year: Number.isInteger(Number(it.year)) && Number(it.year) > 2000 ? Number(it.year) : null,
        storages: JSON.stringify(sortNum(num(it.storages, storageFromField))), rams: JSON.stringify(sortNum(num(it.rams, ramFromField))),
        colors: JSON.stringify(num(it.colors, (c) => parseQuery(String(c)).color)), specs: null,
        source: 'external', verified: 0, created_at: now, updated_at: now,
      };
      toWrite.push(row);
      byId.set(d.model_id, { ...row });
      sum.external++;
    }
  }

  // ردیف‌های تازه/تغییرکرده؛ مدل‌های دستی/خارجی (source≠observed) با WHERE محافظت می‌شوند
  const w = await upsertMany(d1, {
    table: 'device_catalog', columns: CATALOG_COLUMNS, rows: toWrite, conflict: 'model_id',
    updateColumns: ['storages', 'rams', 'colors', 'updated_at'], where: "device_catalog.source = 'observed'",
  });
  if (w.failed) console.error(`⚠️  ${w.failed} مدل در کاتالوگ ذخیره نشد: ${w.errors[0]}`);

  // model_tokens: برای همه‌ی مدل‌های کاتالوگ، توکن‌های کاندید (نام بدون برند + توکن‌های یادگرفته‌شده)
  const have = new Set((await d1.query('SELECT token, model_id FROM model_tokens')).map((r) => `${r.model_id}\u0000${r.token}`));
  const tokenRows = [];
  for (const c of byId.values()) {
    const set = candidateTokenSet({ model_id: c.model_id, brand: c.brand, name_tokens: nameTokens(`${c.brand} ${c.name}`), alias_tokens: parseJsonArray(c.alias_tokens) });
    for (const t of set) if (!have.has(`${c.model_id}\u0000${t}`)) tokenRows.push({ token: t, model_id: c.model_id });
  }
  sum.tokensAdded = await insertIgnoreMany(d1, { table: 'model_tokens', columns: ['token', 'model_id'], rows: tokenRows });

  log(
    `✅ catalog — مدل‌های مشاهده‌شده ${sum.observed} | جدید ${sum.created} | به‌روزشده ${sum.updated} | توکن تازه ${sum.tokensAdded} | ` +
    `از منبع خارجی ${sum.external} | بدون برند ${sum.noBrand}${extBase ? '' : ' | منبع خارجی: خاموش'}`
  );
  return sum;
}

if (isMain(import.meta.url)) await runJob('catalog', (ctx) => runCatalog(ctx));
