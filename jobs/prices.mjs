// کار prices (روزانه): میانگین بازار ۷۲ ساعت اخیر برای هر (مدل، حافظه، رنگ، وضعیت، بخش).
//
//  • پنجره: ۷۲ ساعت بر اساس listings.first_seen
//  • دروازه‌ی کیفیت: قیمت معتبر، تطبیق قطعی، بدون پرچم سخت/لوازم/خراب، وضعیت دستگاه معلوم، حذف تکراری‌ها
//  • سلسله‌مراتب: سطح ۱ (مدل+حافظه+رنگ) ← ۲ (مدل+حافظه) ← ۳ (مدل)، با n_min=5 (pickLevel)
//  • حذف پرت: MAD وقتی n ≥ ۶، IQR وقتی n = ۵ (summarize)
//  • خروجی: market_price_daily با status='pending'. ردیفی که امروز تصمیم‌گیری شده (approved/…) دست نمی‌خورد.
//  • flagged=1 اگر n < ۵ یا جهش > ۱۵٪ نسبت به آخرین مقدار تاییدشده‌ی همان کلید.
//
// رمزگذاری «ناشناخته» در کلید: حافظه 0 و رنگ ''. ردیف سطح ۲ رنگ '' و ردیف سطح ۳ حافظه 0 و رنگ '' دارد.
// بخش 'personal' از listings.seller_type (مقدار «شخصی») ساخته می‌شود؛ در listing_features ستون segment نیست.
// برای بخش 'personal' فقط ردیف‌های کافی (n ≥ ۵) نوشته می‌شود تا صف تاییدیه شلوغ نشود.
import { summarize, pickLevel, N_MIN, tehranDay, HARD_FLAGS } from '../shared/core/core.mjs';
import { isoAgo, parseJsonArray, chunk, placeholders, upsertMany, runJob, isMain } from '../shared/job-utils.mjs';

const WINDOW_HOURS = 72;
const JUMP_FLAG = 0.15;
const WORKER_METHODS = new Set(['ai', 'admin', 'manual', 'alias']);
const CONDS = new Set(['new', 'likenew', 'used']);
const PERSONAL = 'شخصی';

export const PRICE_COLUMNS = [
  'day', 'model_id', 'storage_gb', 'color', 'cond_class', 'segment', 'level', 'n', 'n_removed', 'mean', 'median', 'min', 'max',
  'status', 'prev_mean', 'flagged', 'note',
];
const UPDATE_COLUMNS = ['level', 'n', 'n_removed', 'mean', 'median', 'min', 'max', 'prev_mean', 'flagged', 'note'];
const keyOf = (r) => `${r.model_id}|${r.storage_gb}|${r.color}|${r.cond_class}|${r.segment}`;

/** دروازه‌ی کیفیت؛ برمی‌گرداند { rows, dropped: {دلیل: تعداد} } */
export function filterListings(rows, { floor = 500_000, ceiling = 2_000_000_000 } = {}) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  const kept = [];
  const seen = new Set();
  for (const r of rows) {
    const price = Number(r.price);
    if (!Number.isFinite(price) || price < floor || price > ceiling || (r.price_note && String(r.price_note).trim())) { drop('price'); continue; }
    const confirmed = WORKER_METHODS.has(r.match_method) || (r.match_method === 'auto' && Number(r.match_score) >= 0.85);
    if (!r.model_id || !confirmed) { drop('match'); continue; }
    if (r.excluded) { drop('excluded'); continue; }
    const flags = parseJsonArray(r.flags);
    if (flags.some((f) => HARD_FLAGS.includes(f))) { drop('flag'); continue; }
    if (!CONDS.has(r.cond_class)) { drop('condition'); continue; }
    const dupKey = `${r.model_id}|${r.storage_gb}|${r.color}|${r.cond_class}|${price}|${r.neighborhood ?? ''}`;
    if (seen.has(dupKey)) { drop('duplicate'); continue; }
    seen.add(dupKey);
    kept.push({ ...r, price, storage_gb: Number(r.storage_gb) || 0, color: r.color || '' });
  }
  return { rows: kept, dropped };
}

/** ساخت ردیف‌های قیمت برای یک بخش (segment) */
export function buildPriceRows(rows, segment, day) {
  const g1 = new Map(); const g2 = new Map(); const g3 = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of rows) {
    push(g3, `${r.model_id}|${r.cond_class}`, r.price);
    if (r.storage_gb > 0) {
      push(g2, `${r.model_id}|${r.storage_gb}|${r.cond_class}`, r.price);
      if (r.color) push(g1, `${r.model_id}|${r.storage_gb}|${r.color}|${r.cond_class}`, r.price);
    }
  }
  const out = new Map();
  const leaves = new Map(rows.map((r) => [`${r.model_id}|${r.storage_gb}|${r.color}|${r.cond_class}`, r]));
  for (const r of leaves.values()) {
    const levels = [];
    if (r.storage_gb > 0 && r.color) levels.push({ level: 1, values: g1.get(`${r.model_id}|${r.storage_gb}|${r.color}|${r.cond_class}`), meta: { storage_gb: r.storage_gb, color: r.color } });
    if (r.storage_gb > 0) levels.push({ level: 2, values: g2.get(`${r.model_id}|${r.storage_gb}|${r.cond_class}`), meta: { storage_gb: r.storage_gb, color: '' } });
    levels.push({ level: 3, values: g3.get(`${r.model_id}|${r.cond_class}`), meta: { storage_gb: 0, color: '' } });
    let picked = pickLevel(levels, N_MIN);
    if (!picked) {
      if (segment !== 'all') continue;
      const l3 = levels[levels.length - 1];
      picked = { level: 3, summary: summarize(l3.values), meta: l3.meta };
    }
    const row = {
      day, model_id: r.model_id, storage_gb: picked.meta.storage_gb, color: picked.meta.color, cond_class: r.cond_class, segment,
      level: picked.level, n: picked.summary.kept, n_removed: picked.summary.removed,
      mean: picked.summary.mean, median: picked.summary.median, min: picked.summary.min, max: picked.summary.max,
      status: 'pending', prev_mean: null, flagged: 0, note: null,
    };
    out.set(keyOf(row), row);
  }
  return [...out.values()];
}

const SELECT_SQL = `
SELECT l.token, l.price, l.price_note, l.seller_type, l.neighborhood, l.first_seen,
       f.model_id, f.storage_gb, f.color, f.cond_class, f.flags, f.excluded, f.match_score, f.match_method
FROM listings l JOIN listing_features f ON f.token = l.token
WHERE l.first_seen >= ? AND f.model_id IS NOT NULL
ORDER BY l.first_seen ASC`;

export async function runPrices({ d1, now = Date.now(), log = console.log, env = process.env } = {}) {
  const day = tehranDay(now);
  const sum = { day, input: 0, kept: 0, rows: 0, flagged: 0, written: 0, unchanged: 0, locked: 0, dropped: {} };

  const raw = await d1.query(SELECT_SQL, [isoAgo(now, WINDOW_HOURS)]);
  sum.input = raw.length;
  const floor = Number(env.PRICE_FLOOR || 500_000);
  const { rows: good, dropped } = filterListings(raw, { floor });
  sum.kept = good.length;
  sum.dropped = dropped;

  const personal = good.filter((r) => r.seller_type === PERSONAL);
  const built = [...buildPriceRows(good, 'all', day), ...buildPriceRows(personal, 'personal', day)];
  sum.rows = built.length;

  // آخرین مقدار تاییدشده‌ی هر کلید (۴۵ روز اخیر) برای محاسبه‌ی جهش
  const prev = new Map();
  const models = [...new Set(built.map((r) => r.model_id))];
  const since = tehranDay(now - 45 * 86_400_000);
  for (const part of chunk(models, 80)) {
    const got = await d1.query(
      `SELECT model_id, storage_gb, color, cond_class, segment, mean, day FROM market_price_daily
       WHERE status IN ('approved', 'manual', 'auto') AND day < ? AND day >= ? AND mean IS NOT NULL AND model_id IN (${placeholders(part.length)})
       ORDER BY day DESC`,
      [day, since, ...part]
    );
    for (const g of got) { const k = keyOf(g); if (!prev.has(k)) prev.set(k, Number(g.mean)); }
  }
  for (const r of built) {
    const notes = [];
    if (r.n < N_MIN) notes.push('n<5');
    const p = prev.get(keyOf(r));
    if (p && r.mean) {
      r.prev_mean = p;
      const jump = (r.mean - p) / p;
      if (Math.abs(jump) > JUMP_FLAG) notes.push(`jump:${jump > 0 ? '+' : ''}${Math.round(jump * 100)}%`);
    }
    r.flagged = notes.length ? 1 : 0;
    r.note = notes.length ? notes.join(' | ') : null;
    if (r.flagged) sum.flagged++;
  }

  // idempotent: ردیف‌های امروز را بخوان؛ تصمیم‌گرفته‌شده‌ها و بی‌تغییرها نوشته نشوند
  const today = await d1.query(`SELECT ${PRICE_COLUMNS.join(', ')} FROM market_price_daily WHERE day = ?`, [day]);
  const existing = new Map(today.map((r) => [keyOf(r), r]));
  const toWrite = [];
  for (const r of built) {
    const ex = existing.get(keyOf(r));
    if (ex && ex.status !== 'pending') { sum.locked++; continue; }
    if (ex && UPDATE_COLUMNS.every((c) => (ex[c] ?? null) === (r[c] ?? null))) { sum.unchanged++; continue; }
    toWrite.push(r);
  }
  const w = await upsertMany(d1, {
    table: 'market_price_daily', columns: PRICE_COLUMNS, rows: toWrite,
    conflict: ['day', 'model_id', 'storage_gb', 'color', 'cond_class', 'segment'], updateColumns: UPDATE_COLUMNS,
    where: "market_price_daily.status = 'pending'",
  });
  sum.written = w.written;
  if (w.failed) console.error(`⚠️  ${w.failed} ردیف قیمت ذخیره نشد: ${w.errors[0]}`);

  const why = Object.entries(dropped).map(([k, v]) => `${k}×${v}`).join('، ') || '-';
  log(
    `✅ prices — روز ${day} | آگهی ورودی ${sum.input} | پس از دروازه‌ی کیفیت ${sum.kept} (حذف: ${why}) | ردیف قیمت ${sum.rows} ` +
    `(علامت‌دار ${sum.flagged}) | نوشته‌شده ${sum.written} | بی‌تغییر ${sum.unchanged} | تصمیم‌گرفته‌شده ${sum.locked}`
  );
  return sum;
}

if (isMain(import.meta.url)) await runJob('prices', (ctx) => runPrices(ctx));
