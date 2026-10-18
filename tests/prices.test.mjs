import { makeWorld, insertListing } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import { runPrices, filterListings, buildPriceRows, PRICE_COLUMNS } from '../jobs/prices.mjs';

let w;
let d1;
const NOW = Date.parse('2026-10-05T10:00:00.000Z'); // ۱۳:۳۰ تهران، ۵ اکتبر
const DAY = '2026-10-05';
beforeEach(() => { w = makeWorld(); d1 = makeD1Client(); });
afterEach(() => w.restore());

let seq = 0;
/** آگهی + ویژگی‌های تطبیق‌خورده */
function addFeatured(o = {}) {
  const token = o.token ?? `F${++seq}`;
  insertListing(w, { token, now: NOW, price: o.price ?? 18_000_000, seller_type: o.seller_type ?? 'شخصی', neighborhood: o.neighborhood ?? `محله ${seq}`, price_note: o.price_note ?? null });
  w.run(
    `INSERT INTO listing_features (token, model_id, storage_gb, color, cond_class, flags, excluded, match_score, match_method, features_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    token, o.model_id ?? 'apple_iphone_13', o.storage_gb ?? 128, o.color ?? 'black', o.cond_class ?? 'used', o.flags ?? '[]', o.excluded ?? null,
    o.match_score ?? 1, o.match_method ?? 'auto',
  );
  return token;
}
const run = (o = {}) => quiet(() => runPrices({ d1, now: NOW, log: () => {}, env: { ...process.env, ...(o.env ?? {}) } })).then((r) => r.result);
const mpd = (where = '1=1', ...p) => w.rows(`SELECT * FROM market_price_daily WHERE ${where} ORDER BY model_id, storage_gb, color, cond_class, segment`, ...p);
const prices = (n, base = 18_000_000, step = 100_000) => Array.from({ length: n }, (_, i) => base + i * step);

test('دروازه‌ی کیفیت: هر دلیل حذف شمارش می‌شود', () => {
  const base = { price: 18_000_000, price_note: null, model_id: 'm', match_method: 'auto', match_score: 0.9, excluded: null, flags: '[]', cond_class: 'used', storage_gb: 128, color: 'black', neighborhood: 'x' };
  const rows = [
    { ...base }, // معتبر
    { ...base, price: 100, neighborhood: 'a' },
    { ...base, price: 3_000_000_000, neighborhood: 'b' },
    { ...base, price_note: 'قیمت نامعتبر', neighborhood: 'c' },
    { ...base, match_method: 'verify', neighborhood: 'd' },
    { ...base, match_score: 0.8, neighborhood: 'e' }, // auto زیر ۰٫۸۵
    { ...base, model_id: null, neighborhood: 'f' },
    { ...base, excluded: 'accessory', neighborhood: 'g' },
    { ...base, flags: '["icloud_locked"]', neighborhood: 'h' },
    { ...base, flags: '["repaired_screen"]', neighborhood: 'i' }, // پرچم نرم مانعی ندارد
    { ...base, cond_class: 'broken', neighborhood: 'j' },
    { ...base, cond_class: null, neighborhood: 'k' },
    { ...base, match_method: 'ai', match_score: 0.7, neighborhood: 'l' }, // تطبیق Worker همیشه معتبر
    { ...base }, // تکراری عین اولی
  ];
  const { rows: kept, dropped } = filterListings(rows);
  assert.equal(kept.length, 3);
  assert.deepEqual(dropped, { price: 3, match: 3, excluded: 1, flag: 1, condition: 2, duplicate: 1 });
});

test('buildPriceRows: سطح ۱ با نمونه‌ی کافی؛ سطح ۲ و ۳ وقتی کم است؛ حذف پرت', () => {
  const mk = (price, o = {}) => ({ model_id: 'm', cond_class: 'used', storage_gb: 128, color: 'black', price, ...o });
  // ۶ آگهی هم‌رنگ → سطح ۱
  const l1 = buildPriceRows(prices(6).map((p) => mk(p)), 'all', DAY);
  assert.equal(l1.length, 1);
  assert.deepEqual([l1[0].level, l1[0].n, l1[0].storage_gb, l1[0].color, l1[0].segment, l1[0].status, l1[0].day], [1, 6, 128, 'black', 'all', 'pending', DAY]);
  // ۳ مشکی + ۳ سفید → سطح ۲ (حافظه) با n=۶ و رنگ خالی
  const l2 = buildPriceRows([...prices(3).map((p) => mk(p)), ...prices(3, 17_000_000).map((p) => mk(p, { color: 'white' }))], 'all', DAY);
  assert.deepEqual(l2.map((r) => [r.level, r.n, r.color, r.storage_gb]), [[2, 6, '', 128]]);
  // دو حافظه‌ی مختلف با نمونه‌ی کم → سطح ۳ (مدل) و حافظه ۰
  const l3 = buildPriceRows([...prices(3).map((p) => mk(p)), ...prices(3, 30_000_000).map((p) => mk(p, { storage_gb: 256, color: 'white' }))], 'all', DAY);
  assert.deepEqual(l3.map((r) => [r.level, r.n, r.storage_gb, r.color]), [[3, 6, 0, '']]);
  // نمونه‌ی کم در همه‌ی سطح‌ها: بخش all می‌نویسد (flag می‌شود)، بخش personal نمی‌نویسد
  const few = [mk(18_000_000), mk(19_000_000)];
  assert.equal(buildPriceRows(few, 'all', DAY).length, 1);
  assert.equal(buildPriceRows(few, 'all', DAY)[0].n, 2);
  assert.equal(buildPriceRows(few, 'personal', DAY).length, 0);
  // داده‌ی پرت (قیمت اشتباه) حذف می‌شود
  const withOutlier = buildPriceRows([...prices(7).map((p) => mk(p)), mk(180_000_000)], 'all', DAY)[0];
  assert.equal(withOutlier.n_removed, 1);
  assert.equal(withOutlier.n, 7);
  assert.ok(withOutlier.max < 20_000_000);
});

test('اجرا: ردیف pending با علامت n<5 و بخش personal فقط با نمونه‌ی کافی', async () => {
  for (const p of prices(6)) addFeatured({ price: p });                 // ۶ شخصی
  addFeatured({ price: 40_000_000, model_id: 'samsung_galaxy_a54', color: 'white', seller_type: 'فروشگاه/آژانس' }); // یک فروشگاهی، مدل دیگر
  const sum = await run();
  assert.equal(sum.day, DAY);
  assert.equal(sum.input, 7);
  assert.equal(sum.kept, 7);
  const rows = mpd();
  const all = rows.filter((r) => r.segment === 'all');
  const personal = rows.filter((r) => r.segment === 'personal');
  assert.equal(all.length, 2);
  assert.equal(personal.length, 1, 'فقط مدلی که ≥۵ نمونه‌ی شخصی دارد');
  const iphone = all.find((r) => r.model_id === 'apple_iphone_13');
  assert.deepEqual([iphone.status, iphone.n, iphone.level, iphone.flagged, iphone.note, iphone.decided_by], ['pending', 6, 1, 0, null, null]);
  const tiny = all.find((r) => r.model_id === 'samsung_galaxy_a54');
  assert.deepEqual([tiny.n, tiny.flagged, tiny.note], [1, 1, 'n<5']);
  assert.ok(iphone.mean > 18_000_000 && iphone.min === 18_000_000 && iphone.max === 18_500_000);
  assert.equal(sum.written, 3);
});

test('اجرای دوباره: ردیف بی‌تغییر نوشته نمی‌شود؛ تغییر داده pending را به‌روز می‌کند', async () => {
  for (const p of prices(6)) addFeatured({ price: p });
  await run();
  const before = w.writes;
  const again = await run();
  assert.deepEqual([again.written, again.unchanged], [0, 2]); // all + personal
  assert.equal(w.writes, before);

  addFeatured({ price: 18_300_000 });
  const upd = await run();
  assert.equal(upd.written, 2);
  assert.equal(mpd("segment = 'all'")[0].n, 7);
  assert.equal(mpd().length, 2, 'ردیف جدید نمی‌سازد؛ همان کلید به‌روز می‌شود');
});

test('ردیفی که مدیر تصمیم گرفته (approved/manual/rejected) بازنویسی نمی‌شود', async () => {
  for (const p of prices(6)) addFeatured({ price: p });
  await run();
  w.run("UPDATE market_price_daily SET status = 'approved', decided_by = '2002', mean = 111 WHERE segment = 'all'");
  addFeatured({ price: 18_300_000 });
  const sum = await run();
  assert.equal(sum.locked, 1);
  const row = mpd("segment = 'all'")[0];
  assert.deepEqual([row.status, row.mean, row.decided_by], ['approved', 111, '2002']);
});

test('جهش قیمت بیش از ۱۵٪ نسبت به آخرین مقدار تاییدشده علامت می‌خورد؛ جهش کوچک نه', async () => {
  const seedPrev = (day, mean, status = 'approved') => w.run(
    `INSERT INTO market_price_daily (day, model_id, storage_gb, color, cond_class, segment, level, n, mean, status)
     VALUES (?, 'apple_iphone_13', 128, 'black', 'used', 'all', 1, 8, ?, ?)`, day, mean, status);
  seedPrev('2026-10-03', 12_000_000);              // مقدار تاییدشده‌ی قدیمی‌تر (باید نادیده بماند)
  seedPrev('2026-10-04', 14_000_000);              // آخرین مقدار تاییدشده
  for (const p of prices(6)) addFeatured({ price: p });
  await run();
  const row = mpd("segment = 'all' AND day = ?", DAY)[0];
  assert.equal(row.prev_mean, 14_000_000);
  assert.equal(row.flagged, 1);
  assert.match(row.note, /^jump:\+\d+%$/);

  // جهش کوچک: پرچم ندارد
  w.run("DELETE FROM market_price_daily WHERE day = ?", DAY);
  w.run("UPDATE market_price_daily SET mean = 18200000 WHERE day = '2026-10-04'");
  await run();
  const small = mpd("segment = 'all' AND day = ?", DAY)[0];
  assert.deepEqual([small.prev_mean, small.flagged, small.note], [18_200_000, 0, null]);
});

test('کف قیمت قابل‌تنظیم با PRICE_FLOOR', async () => {
  for (const p of prices(6, 2_000_000)) addFeatured({ price: p });
  assert.equal((await run()).kept, 6); // کف پیش‌فرض ۵۰۰ هزار
  w.run('DELETE FROM market_price_daily');
  const sum = await run({ env: { PRICE_FLOOR: '5000000' } });
  assert.equal(sum.kept, 0);
  assert.equal(sum.dropped.price, 6);
  assert.equal(mpd().length, 0);
});

test('آگهی خارج از ۷۲ ساعت یا بدون مدل در آمار نمی‌آید', async () => {
  for (const p of prices(5)) addFeatured({ price: p });
  const t = addFeatured({ price: 99_000_000 });
  w.run('UPDATE listings SET first_seen = ? WHERE token = ?', new Date(NOW - 100 * 3_600_000).toISOString(), t);
  w.run("INSERT INTO listings (token, price, first_seen, seller_type) VALUES ('nomodel', 18000000, ?, 'شخصی')", new Date(NOW - 3_600_000).toISOString());
  w.run("INSERT INTO listing_features (token, model_id, match_method) VALUES ('nomodel', NULL, 'verify')");
  const sum = await run();
  assert.equal(sum.input, 5);
  assert.equal(mpd("segment = 'all'")[0].n, 5);
});

test('۱۰۰ مدل مختلف: هیچ کوئری بیش از ۱۰۰ پارامتر ندارد', async () => {
  for (let m = 0; m < 100; m++) for (let i = 0; i < 5; i++) addFeatured({ model_id: `brand_model_${m}`, price: 10_000_000 + i * 50_000 });
  const sum = await run();
  assert.equal(sum.rows, 200); // all + personal
  assert.equal(sum.written, 200);
  assert.equal(mpd().length, 200);
});

test('ستون‌های خروجی با ساختار market_price_daily هم‌خوان‌اند', () => {
  const cols = new Set(w.rows('PRAGMA table_info(market_price_daily)').map((c) => c.name));
  for (const c of PRICE_COLUMNS) assert.ok(cols.has(c), `ستون ${c} در جدول نیست`);
});
