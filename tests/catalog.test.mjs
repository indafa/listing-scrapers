import { makeWorld, insertListing } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { seedCatalog } from './helpers/catalog-seed.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import { runCatalog, prettyName, describeModel, aggregateObserved, parseExternalList } from '../jobs/catalog.mjs';

let w;
let d1;
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
beforeEach(() => { w = makeWorld(); d1 = makeD1Client(); });
afterEach(() => w.restore());

const add = (token, o = {}) => insertListing(w, { token, now: NOW, ...o });
const run = (o = {}) => quiet(() => runCatalog({ d1, now: NOW, log: () => {}, env: {}, ...o })).then((r) => r.result);

test('prettyName و describeModel', () => {
  assert.equal(prettyName(['galaxy', 'a', '54']), 'Galaxy A54');
  assert.equal(prettyName(['iphone', '13', 'pro', 'max']), 'iPhone 13 Pro Max');
  assert.equal(prettyName(['galaxy', 's', '23', 'fe']), 'Galaxy S23 FE');
  assert.deepEqual(describeModel('Apple iPhone 13 Pro Max'), { brand: 'apple', tokens: ['iphone', '13', 'pro', 'max'], model_id: 'apple_iphone_13_pro_max', name: 'iPhone 13 Pro Max' });
  assert.equal(describeModel('شیائومی Redmi Note 12').model_id, 'xiaomi_redmi_note_12');
  assert.equal(describeModel('Xiaomi 13T').name, '13T');
  assert.equal(describeModel('Redmi 12C').name, 'Redmi 12C');
  assert.equal(describeModel('گوشی'), null);
});

test('aggregateObserved: آستانه‌ی تعداد، مدل برچسب‌خورده از عنوان سخت‌گیرانه‌تر، لوازم جانبی رد می‌شود', () => {
  const r = (o) => ({ brand_model: '', alt_title: '', category: 'mobile-phones', internal_storage: null, ram: null, color: null, c: 1, ...o });
  const { models, noBrand } = aggregateObserved([
    r({ brand_model: 'Apple iPhone 13', c: 3, internal_storage: 128, color: 'مشکی' }),
    r({ brand_model: 'Apple iPhone 14', c: 1 }), // یک آگهی: کم
    r({ brand_model: 'سایر', alt_title: 'سامسونگ Galaxy A54', c: 2 }), // از عنوان: ۳ لازم
    r({ brand_model: 'سایر', alt_title: 'شیائومی Redmi Note 12', c: 3 }),
    r({ brand_model: 'سایر', alt_title: 'قاب iPhone 15', c: 5 }), // لوازم جانبی
    r({ brand_model: 'یک چیز بی‌برند', c: 4 }),
  ], { minListings: 2 });
  assert.deepEqual([...models.keys()].sort(), ['apple_iphone_13', 'xiaomi_redmi_note_12']);
  assert.equal(noBrand, 4);
  assert.deepEqual([...models.get('apple_iphone_13').storages], [[128, 3]]);
});

test('اجرای اول: مدل‌ها و توکن‌ها ساخته می‌شوند؛ نوع تبلت از دسته‌ی آگهی', async () => {
  add('a1'); add('a2', { price: 17_000_000 });
  add('b1', { title: 'اپل iPad 9', category: 'tablet', brand_model: 'Apple iPad 9' }); add('b2', { title: 'اپل iPad 9', category: 'tablet', brand_model: 'Apple iPad 9' });
  add('c1', { brand_model: 'Samsung Galaxy A54' }); // فقط یکی: ساخته نمی‌شود
  const sum = await run();
  assert.deepEqual([sum.observed, sum.created, sum.updated, sum.external], [2, 2, 0, 0]);
  const rows = w.rows('SELECT model_id, brand, name, name_norm, type, storages, rams, colors, source, verified FROM device_catalog ORDER BY model_id');
  assert.deepEqual(rows.map((x) => [x.model_id, x.type, x.source, x.verified]), [['apple_ipad_9', 'tablet', 'observed', 0], ['apple_iphone_13', 'phone', 'observed', 0]]);
  assert.deepEqual([rows[1].name, rows[1].name_norm, rows[1].storages, rows[1].rams, rows[1].colors], ['iPhone 13', 'iphone 13', '[128]', '[4]', '["black"]']);
  const toks = w.rows("SELECT token FROM model_tokens WHERE model_id = 'apple_iphone_13'").map((x) => x.token).sort();
  assert.deepEqual(toks, ['13', 'iphone']);
  assert.equal(sum.tokensAdded, 4);
});

test('اجرای دوم هیچ نوشتن بی‌خودی ندارد؛ حافظه‌ی تازه‌دیده‌شده به مدل اضافه می‌شود (کم نمی‌شود)', async () => {
  add('a1'); add('a2');
  await run();
  const before = w.writes;
  const again = await run();
  assert.deepEqual([again.created, again.updated, again.tokensAdded], [0, 0, 0]);
  assert.equal(w.writes, before);

  add('a3', { internal_storage: 256 }); add('a4', { internal_storage: 256 }); // ۲ مشاهده‌ی ۲۵۶
  const upd = await run();
  assert.equal(upd.updated, 1);
  assert.equal(w.one("SELECT storages FROM device_catalog WHERE model_id = 'apple_iphone_13'").storages, '[128,256]');
  w.run("DELETE FROM listings WHERE token IN ('a3', 'a4')");
  await run();
  assert.equal(w.one("SELECT storages FROM device_catalog WHERE model_id = 'apple_iphone_13'").storages, '[128,256]', 'هیچ‌وقت کم نمی‌شود');
});

test('مدل‌های دستی/خارجی دست‌نخورده می‌مانند ولی توکن‌هایشان کامل می‌شود', async () => {
  seedCatalog(w, 'manual');
  w.run("DELETE FROM model_tokens WHERE model_id = 'apple_iphone_13'");
  w.run("UPDATE device_catalog SET name = 'نام دستی', storages = '[64]' WHERE model_id = 'apple_iphone_13'");
  add('a1', { internal_storage: 512 }); add('a2', { internal_storage: 512 });
  const sum = await run();
  assert.equal(sum.created, 0);
  assert.equal(sum.updated, 0);
  assert.deepEqual(w.one("SELECT name, storages FROM device_catalog WHERE model_id = 'apple_iphone_13'"), { name: 'نام دستی', storages: '[64]' });
  assert.ok(w.one("SELECT COUNT(*) AS c FROM model_tokens WHERE model_id = 'apple_iphone_13'").c >= 2);
});

test('لوازم جانبی با برچسب «سایر» مدل جدید نمی‌سازند', async () => {
  for (let i = 0; i < 4; i++) add(`acc${i}`, { title: 'قاب iPhone 15 سیلیکونی', brand_model: 'سایر', category: 'mobile-phones' });
  const sum = await run();
  assert.equal(sum.created, 0);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM device_catalog').c, 0);
});

test('منبع خارجی: JSON و متن ساده؛ فقط مدل‌های نبوده؛ خطا هشدار است نه شکست', async () => {
  const logs = [];
  const log = (m) => logs.push(m);
  w.route('https://ext.test/list.json', () => new Response(JSON.stringify([
    'Apple iPhone 14',
    { name: 'Galaxy S22', brand: 'samsung', year: 2022, storages: [128, 256], rams: [8], colors: ['مشکی'] },
    { name: 'iPad Air 5', type: 'tablet' },
  ])));
  const sum = await runCatalog({ d1, now: NOW, log, env: { CATALOG_SOURCE_BASE: 'https://ext.test/list.json' } });
  assert.equal(sum.external, 3);
  const g = w.one("SELECT * FROM device_catalog WHERE model_id = 'samsung_galaxy_s22'");
  assert.deepEqual([g.source, g.verified, g.year, g.storages, g.rams, g.colors], ['external', 0, 2022, '[128,256]', '[8]', '["black"]']);
  assert.equal(w.one("SELECT type FROM device_catalog WHERE model_id = 'apple_ipad_air_5'").type, 'tablet');
  // بار دوم: همه موجودند
  assert.equal((await runCatalog({ d1, now: NOW, log, env: { CATALOG_SOURCE_BASE: 'https://ext.test/list.json' } })).external, 0);

  // خطاها
  const bad = async (handler, base = 'https://ext.test/bad') => {
    w.route(base, handler);
    logs.length = 0;
    const s = await runCatalog({ d1, now: NOW, log, env: { CATALOG_SOURCE_BASE: base } });
    return { s, logs: logs.join('\n') };
  };
  assert.match((await bad(() => new Response('x', { status: 503 }))).logs, /پاسخ 503 داد/);
  assert.match((await bad(() => new Response('<!DOCTYPE html><html>'))).logs, /HTML/);
  assert.match((await bad(() => { throw new TypeError('network down'); })).logs, /در دسترس نبود/);
  const http = await runCatalog({ d1, now: NOW, log, env: { CATALOG_SOURCE_BASE: 'http://insecure.test/x' } });
  assert.equal(http.external, 0);
  assert.ok(logs.some((l) => /https/.test(l)));
});

test('منبع خارجی از تنظیم catalog_source_base پنل هم خوانده می‌شود', async () => {
  w.run("INSERT INTO bot_settings (key, value) VALUES ('catalog_source_base', 'https://ext.test/s.txt')");
  w.route('https://ext.test/s.txt', () => new Response('# فهرست\nApple iPhone 15\nGalaxy S24'));
  const sum = await run();
  assert.equal(sum.external, 2);
});

test('parseExternalList: شکل‌های پشتیبانی‌شده', () => {
  assert.deepEqual(parseExternalList('[{"name":"A"},"B",{"title":"C"},{"x":1},5]').items.map((x) => x.name), ['A', 'B', 'C']);
  assert.deepEqual(parseExternalList('{"models":["M1","M2"]}').items.length, 2);
  assert.deepEqual(parseExternalList('{"items":["M1"]}').items.length, 1);
  assert.deepEqual(parseExternalList('{"data":["M1"]}').items.length, 1);
  assert.deepEqual(parseExternalList('خط اول\n\n# نظر\nخط دوم').items.map((x) => x.name), ['خط اول', 'خط دوم']);
  assert.equal(parseExternalList('<html><body>').unsupported, true);
  assert.deepEqual(parseExternalList(null).items, []);
});

test('هیچ کوئری بیش از ۱۰۰ پارامتر ندارد (۱۲۰ مدل متفاوت)', async () => {
  for (let i = 0; i < 120; i++) { add(`n${i}a`, { brand_model: `Apple iPhone ${100 + i}` }); add(`n${i}b`, { brand_model: `Apple iPhone ${100 + i}` }); }
  const sum = await run();
  assert.equal(sum.created, 120);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM device_catalog').c, 120);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM model_tokens').c, sum.tokensAdded);
});
