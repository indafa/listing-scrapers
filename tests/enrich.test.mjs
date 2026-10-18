import { makeWorld, insertListing } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { seedCatalog } from './helpers/catalog-seed.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import { runEnrich, storageFromField, ramFromField, isAccessoryTitle, matchListing, loadCatalogIndex, findCandidatesLocal, FEATURES_VERSION } from '../jobs/enrich.mjs';

let w;
let d1;
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
beforeEach(() => { w = makeWorld(); d1 = makeD1Client(); });
afterEach(() => w.restore());

const add = (token, o = {}) => insertListing(w, { token, now: NOW, ...o });
const enrich = (o = {}) => quiet(() => runEnrich({ d1, now: NOW, log: () => {}, ...o })).then((r) => r.result);
const feat = (token) => w.one('SELECT * FROM listing_features WHERE token = ?', token);

test('storageFromField / ramFromField', () => {
  assert.equal(storageFromField(128), 128);
  assert.equal(storageFromField('256'), 256);
  assert.equal(storageFromField(1), 1024); // «۱ ترابایت»
  assert.equal(storageFromField(2), 2048);
  assert.equal(storageFromField(100), null);
  assert.equal(storageFromField(null), null);
  assert.equal(storageFromField('abc'), null);
  assert.equal(ramFromField(8), 8);
  assert.equal(ramFromField(0), null);
  assert.equal(ramFromField(64), null);
  assert.equal(ramFromField(2.5), null);
});

test('isAccessoryTitle: مرز واژه‌ی فارسی درست کار می‌کند (باگ \\b)', () => {
  for (const t of ['قاب iPhone 13', 'گلس سامسونگ A54', 'شارژر اصلی اپل', 'کابل شارژ تایپ سی', 'باتری اورجینال', 'ساعت هوشمند شیائومی', 'قاب']) assert.equal(isAccessoryTitle(t), true, t);
  for (const t of ['گوشی iPhone 13', 'قابل معامله iPhone 13', 'iPhone 13 با قاب', 'کیفیت عالی iPhone', 'پایهدار', '', null]) assert.equal(isAccessoryTitle(t), false, String(t));
});

test('تطبیق: قطعی، نیازمند تایید و بی‌تطبیق؛ خروجی ویژگی‌ها و صف بررسی', async () => {
  seedCatalog(w);
  add('auto1');
  add('auto2', { title: 'سامسونگ Galaxy A54', brand_model: 'Samsung Galaxy A54', internal_storage: 128, ram: 6, color: 'سفید', price: 12_000_000 });
  add('ver1', { internal_storage: 512 }); // حافظه‌ای که برای این مدل ثبت نشده
  add('none1', { title: 'گوشی خیلی عجیب qwerty zzz', brand_model: 'سایر' });
  add('acc1', { title: 'قاب iPhone 13', brand_model: 'سایر' });
  add('bad1', { description: 'آیکلود لاک است' });

  const sum = await enrich();
  assert.equal(sum.examined, 6);
  assert.equal(sum.failed, 0);
  assert.equal(sum.written, 6);
  assert.equal(sum.excluded, 2); // لوازم جانبی و آیکلود
  assert.equal(sum.auto + sum.verify + sum.unmatched, 6);

  const a = feat('auto1');
  assert.deepEqual([a.model_id, a.match_method, a.storage_gb, a.ram_gb, a.color, a.cond_class, a.variant_key], ['apple_iphone_13', 'auto', 128, 4, 'black', 'used', 'apple_iphone_13|128gb|black']);
  assert.equal(a.excluded, null);
  assert.ok(a.score > 0 && a.features_at === NOW && a.desc_hash.length === 40);
  assert.equal(JSON.parse(a.flags).length, 0);

  assert.equal(feat('auto2').model_id, 'samsung_galaxy_a54');
  assert.equal(feat('auto2').color, 'white');

  const v = feat('ver1');
  assert.equal(v.match_method, 'verify');
  assert.equal(v.model_id, null);
  assert.equal(v.storage_gb, 512);

  const n = feat('none1');
  assert.deepEqual([n.match_method, n.model_id, n.match_score], ['unmatched', null, 0]);

  assert.equal(feat('acc1').excluded, 'accessory');
  assert.equal(feat('bad1').excluded, 'icloud_locked');
  assert.deepEqual(JSON.parse(feat('bad1').flags), ['icloud_locked']);

  // صف بررسی: verify برای AI، open برای دستی؛ متن «سایر» جایگزین عنوان شده تا چند آگهی یکی نشوند
  const q = w.rows("SELECT ref, text, status FROM unmatched_queue WHERE source = 'listing' ORDER BY ref");
  assert.deepEqual(q.map((x) => [x.ref, x.status]), [['none1', 'open'], ['ver1', 'verify']]);
  assert.equal(q[0].text, 'گوشی خیلی عجیب qwerty zzz');
  assert.ok(JSON.parse(w.one("SELECT candidates FROM unmatched_queue WHERE ref = 'ver1'").candidates).every((c) => c.model_id));

  // match_log فقط برای تصمیم‌های تازه
  const log = w.rows("SELECT ref, method FROM match_log WHERE source = 'listing'");
  assert.ok(log.length >= 4 && log.every((x) => x.method && x.ref));
});

test('چند آگهی «سایر» با عنوان‌های متفاوت هرکدام ردیف جدا در صف دارند', async () => {
  seedCatalog(w);
  add('o1', { title: 'گوشی ناشناس aaa111', brand_model: 'سایر' });
  add('o2', { title: 'گوشی ناشناس bbb222', brand_model: 'سایر' });
  add('o3', { title: 'گوشی ناشناس ccc333', brand_model: null });
  await enrich();
  const q = w.rows("SELECT ref FROM unmatched_queue WHERE status = 'open' ORDER BY ref");
  assert.deepEqual(q.map((x) => x.ref), ['o1', 'o2', 'o3']);
});

test('بار دوم بدون تغییر چیزی را دوباره پردازش یا ننوشت؛ با تغییر توضیح، فقط همان بازمحاسبه می‌شود', async () => {
  seedCatalog(w);
  add('s1'); add('s2', { token: 's2', title: 'اپل iPhone 13 صفحه عوض شده' });
  await enrich();
  const written = w.writes;
  const again = await enrich();
  assert.equal(again.examined, 0);
  assert.equal(w.writes, written);

  // last_seen تازه می‌شود ولی محتوا یکی است → «بدون تغییر»، هیچ نوشتنی نیست
  w.run('UPDATE listings SET last_seen = ?', new Date(NOW + 60_000).toISOString());
  const touched = await enrich({ now: NOW + 120_000 });
  assert.deepEqual([touched.examined, touched.unchanged, touched.written], [2, 2, 0]);

  // توضیح تغییر کند → هش عوض می‌شود → دوباره محاسبه
  w.run("UPDATE listings SET description = 'صفحه تعویض شده، باتری ۸۵ درصد', last_seen = ? WHERE token = 's1'", new Date(NOW + 180_000).toISOString());
  const changed = await enrich({ now: NOW + 240_000 });
  assert.equal(changed.written, 1);
  assert.equal(feat('s1').battery_pct, 85);
  assert.deepEqual(JSON.parse(feat('s1').repairs), ['screen', 'battery']);
});

test('تطبیق‌های Worker (ai/admin) بازنویسی نمی‌شوند؛ فقط ویژگی‌های متن تازه می‌شود', async () => {
  seedCatalog(w);
  add('w1', { title: 'گوشی عجیب qqq' , brand_model: 'سایر' });
  w.run(`INSERT INTO listing_features (token, model_id, variant_key, storage_gb, ram_gb, color, cond_class, match_score, match_method, desc_hash, features_at)
         VALUES ('w1', 'apple_iphone_13', 'apple_iphone_13|128gb|black', 128, 4, 'black', 'used', 0.8, 'ai', 'old-hash', 1)`);
  const sum = await enrich();
  assert.equal(sum.examined, 1);
  const f = feat('w1');
  assert.deepEqual([f.model_id, f.match_method, f.match_score], ['apple_iphone_13', 'ai', 0.8]);
  assert.notEqual(f.desc_hash, 'old-hash');
  assert.equal(w.one("SELECT COUNT(*) AS c FROM unmatched_queue").c, 0);
});

test('ردیف verify که Worker تا ۲۴ ساعت حل نکرده به صف دستی (open) می‌رود', async () => {
  seedCatalog(w);
  const ins = (ref, hoursAgo) => w.run(
    "INSERT INTO unmatched_queue (source, ref, text, text_norm, status, created_at) VALUES ('listing', ?, ?, ?, 'verify', ?)",
    ref, `متن ${ref}`, `متن ${ref}`, NOW - hoursAgo * 3_600_000,
  );
  ins('old', 25); ins('fresh', 2);
  w.run("INSERT INTO unmatched_queue (source, ref, text, text_norm, status, created_at) VALUES ('customer', 'c', 'x', 'x', 'verify', 1)");
  const sum = await enrich();
  assert.equal(sum.demoted, 1);
  assert.equal(w.one("SELECT status FROM unmatched_queue WHERE ref = 'old'").status, 'open');
  assert.equal(w.one("SELECT status FROM unmatched_queue WHERE ref = 'fresh'").status, 'verify');
  assert.equal(w.one("SELECT status FROM unmatched_queue WHERE ref = 'c'").status, 'verify', 'منبع غیر از آگهی دست‌نخورده');
});

test('وقتی مدل به کاتالوگ اضافه شود، آگهی حل‌نشده بعد از ۶ ساعت قطعی می‌شود و صفش resolved می‌شود', async () => {
  add('late1');
  const first = await enrich();
  assert.equal(first.unmatched, 1);
  assert.equal(w.one("SELECT status FROM unmatched_queue WHERE ref = 'late1'").status, 'open');
  assert.equal(first.examined, 1);

  seedCatalog(w);
  const soon = await enrich({ now: NOW + 3_600_000 }); // هنوز زود است
  assert.equal(soon.examined, 0);

  const later = await enrich({ now: NOW + 7 * 3_600_000 });
  assert.equal(later.auto, 1);
  assert.equal(feat('late1').model_id, 'apple_iphone_13');
  assert.equal(w.one("SELECT status FROM unmatched_queue WHERE ref = 'late1'").status, 'resolved');
});

test('کاتالوگ خالی: همه بی‌تطبیق و پیام روشن', async () => {
  add('e1');
  const logs = [];
  const sum = await runEnrich({ d1, now: NOW, log: (m) => logs.push(m) });
  assert.equal(sum.unmatched, 1);
  assert.ok(logs.some((m) => /کاتالوگ خالی/.test(m)));
});

test('ایندکس کاتالوگ و جست‌وجوی کاندیدها (ترتیب کاهشی برخورد، برند)', async () => {
  seedCatalog(w);
  const index = await loadCatalogIndex(d1);
  assert.equal(index.models.size, 3);
  assert.deepEqual(findCandidatesLocal(index, ['iphone', '13']).map((m) => m.model_id), ['apple_iphone_13']);
  assert.deepEqual(findCandidatesLocal(index, []).length, 0);
  const both = findCandidatesLocal(index, ['9', '13']);
  assert.deepEqual(both.map((m) => m.model_id).sort(), ['apple_ipad_9', 'apple_iphone_13']);
  assert.deepEqual(findCandidatesLocal(index, ['9', '13'], 12, 'samsung'), []);
  const m = matchListing({ title: 'اپل iPhone 13', brand_model: 'Apple iPhone 13', internal_storage: 128, ram: 4 }, index);
  assert.equal(m.kind, 'auto');
  assert.equal(m.best.model_id, 'apple_iphone_13');
  // عنوان مدل دیگری را قطعی نشان دهد → تعارض → verify
  const conflict = matchListing({ title: 'Galaxy A54', brand_model: 'Apple iPhone 13', internal_storage: 128, ram: null }, index);
  assert.equal(conflict.kind, 'verify');
});

test('هیچ کوئری D1 بیش از ۱۰۰ پارامتر ندارد (۱۳۰ آگهی بی‌تطبیق)', async () => {
  seedCatalog(w);
  for (let i = 0; i < 130; i++) add(`m${i}`, { title: `گوشی ناشناس xk${i}q`, brand_model: 'سایر' });
  const sum = await enrich({ limit: 200 });
  assert.equal(sum.examined, 130);
  assert.equal(sum.written, 130);
  assert.equal(sum.failed, 0);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listing_features').c, 130);
  // هر متن یکتا یک ردیف؛ چند عنوان تصادفی به‌خاطر عدد داخلشان کاندید پیدا کرده‌اند و verify شده‌اند
  assert.equal(w.one("SELECT COUNT(*) AS c FROM unmatched_queue WHERE status IN ('open', 'verify')").c, 130);
});

test('پنجره‌ی ۹۶ ساعته: آگهی قدیمی‌تر پردازش نمی‌شود؛ نسخه‌ی ویژگی در هش است', async () => {
  seedCatalog(w);
  add('old1', { ageH: 200, seenH: 100 });
  add('new1');
  const sum = await enrich();
  assert.equal(sum.examined, 1);
  assert.equal(feat('old1'), null);
  assert.ok(FEATURES_VERSION);
});
