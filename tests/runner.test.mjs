import { makeWorld, resetExit, detail } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScraper } from '../shared/runner.mjs';
import { CONFIG } from '../categories/mobile-tablet/run.mjs';

let w;
beforeEach(() => { w = makeWorld(); resetExit(); delete process.env.RECIPIENTS_PATH; delete process.env.INGEST_SECRETS_JSON; });
afterEach(() => { w.restore(); resetExit(); delete process.env.RECIPIENTS_PATH; delete process.env.INGEST_SECRETS_JSON; });

const seedSource = () => {
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13', price: 18_000_000 });
  w.addSource('mobile-phones', 'P2', { title: 'شیائومی Redmi Note 12', brandModel: 'Xiaomi Redmi Note 12', price: 9_000_000, storage: '۱۲۸ گیگابایت' });
  w.addSource('mobile-phones', 'P3', { title: 'سامسونگ Galaxy A54', brandModel: 'Samsung Galaxy A54', price: 12_000_000 });
  w.addSource('tablet', 'T1', { title: 'تبلت اپل iPad 9', tablet: true, brandModel: 'Apple iPad 9', price: 10_000_000 });
};
const writesTo = (table) => w.sqlLog.filter((s) => new RegExp(`^INSERT INTO ${table}`).test(s)).length;

test('اجرای اول: همه‌ی آگهی‌ها ذخیره می‌شوند؛ بدون گیرنده هیچ‌کدام «نیازمند ارسال» نیست', async () => {
  seedSource();
  const r = await quiet(() => runScraper(CONFIG));
  const rows = w.rows('SELECT token, category, status, is_broadcasted, broadcast_attempts, delivered_to, first_seen, last_seen, edit_count FROM listings ORDER BY token');
  assert.deepEqual(rows.map((x) => x.token), ['P1', 'P2', 'P3', 'T1']);
  assert.deepEqual(rows.map((x) => x.category), ['mobile-phones', 'mobile-phones', 'mobile-phones', 'tablet']);
  assert.ok(rows.every((x) => x.status === 'new' && x.is_broadcasted === 1 && x.broadcast_attempts === 0 && x.delivered_to === '[]' && x.edit_count === 0));
  assert.ok(rows.every((x) => x.first_seen && x.last_seen));
  assert.equal(process.exitCode ?? 0, 0);
  assert.match(r.text, /گیرنده‌ها: 0/);
  assert.match(r.text, /هیچ گیرنده‌ای ثبت نشده/);
  assert.match(r.text, /نوشتن در D1: 4 ردیف/);
});

test('اجرای دوم بلافاصله: چیزی دوباره نوشته نمی‌شود (سقف نوشتن روزانه‌ی پلن رایگان)', async () => {
  seedSource();
  await quiet(() => runScraper(CONFIG));
  const before = writesTo('listings');
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(writesTo('listings'), before);
  assert.match(r.text, /نوشتن در D1: 0 ردیف \| بدون نوشتن \(بی‌تغییر و تازه\): 4/);
});

test('آگهی بی‌تغییر که بیش از ۶۰ دقیقه پیش دیده شده فقط last_seen را تازه می‌کند و status را seen نگه می‌دارد', async () => {
  seedSource();
  await quiet(() => runScraper(CONFIG));
  const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
  w.run('UPDATE listings SET last_seen = ?', old);
  const r = await quiet(() => runScraper(CONFIG));
  assert.match(r.text, /نوشتن در D1: 4 ردیف/);
  const row = w.one("SELECT status, last_seen, first_seen, edit_count FROM listings WHERE token = 'P1'");
  assert.equal(row.status, 'seen');
  assert.ok(row.last_seen > old);
  assert.equal(row.edit_count, 0);
});

test('ویرایش (تغییر قیمت): status=edited، edit_count+1 و first_seen حفظ می‌شود', async () => {
  seedSource();
  await quiet(() => runScraper(CONFIG));
  const first = w.one("SELECT first_seen FROM listings WHERE token = 'P1'").first_seen;
  w.source.listings.set('P1', { title: 'اپل iPhone 13', price: 16_500_000 });
  await quiet(() => runScraper(CONFIG));
  const row = w.one("SELECT status, price, edit_count, first_seen FROM listings WHERE token = 'P1'");
  assert.deepEqual([row.status, row.price, row.edit_count, row.first_seen], ['edited', 16_500_000, 1, first]);
});

test('جست‌وجو شکست بخورد (مثلاً بلاک): اجرا قرمز می‌شود و چیزی ذخیره نمی‌شود', async () => {
  seedSource();
  w.source.searchStatus = 403;
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(process.exitCode, 1);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listings').c, 0);
  assert.match(r.text, /هیچ‌کدام از شاخه‌ها کامل نشد/);
});

test('نتیجه‌ی خالی برای همه‌ی شاخه‌ها: اجرا قرمز و پیام شماره‌ی شهر', async () => {
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(process.exitCode, 1);
  assert.match(r.text, /SOURCE_CITY_ID=4/);
});

test('فقط یک شاخه بی‌نتیجه است: اجرا سبز می‌ماند', async () => {
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(process.exitCode ?? 0, 0);
  assert.match(r.text, /tablet: هیچ آگهی‌ای در نتایج جست‌وجو نبود/);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listings').c, 1);
});

test('همه‌ی جزئیات خطا بدهند: شاخه شکست‌خورده حساب می‌شود (اجرا قرمز)', async () => {
  seedSource();
  w.source.detailStatus.set('*', 'html');
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(process.exitCode, 1);
  assert.match(r.text, /JSON نبود/);
});

test('شماره‌ی شهر از SOURCE_CITY_ID خوانده می‌شود', async () => {
  const saved = process.env.SOURCE_CITY_ID;
  process.env.SOURCE_CITY_ID = '7';
  try {
    seedSource();
    await quiet(() => runScraper(CONFIG));
    assert.deepEqual(w.source.searchBody.city_ids, ['7']);
  } finally { process.env.SOURCE_CITY_ID = saved; }
});

test('جدول listings نباشد: خطای روشن (اجرا بی‌صدا سبز نمی‌شود)', async () => {
  w.db.exec('DROP TABLE listings');
  await assert.rejects(quiet(() => runScraper(CONFIG)), /جدول listings در این دیتابیس وجود ندارد/);
});

test('ستون ناشناخته نباشد: اجرا متوقف می‌شود؛ ستون delivered_to خودکار اضافه می‌شود', async () => {
  seedSource();
  w.db.exec('ALTER TABLE listings DROP COLUMN delivered_to');
  const r = await quiet(() => runScraper(CONFIG));
  assert.match(r.text, /ستون تازه‌ی «delivered_to» به جدول listings اضافه شد/);
  assert.ok(w.rows('PRAGMA table_info(listings)').some((c) => c.name === 'delivered_to'));
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listings').c, 4);

  w.db.exec('ALTER TABLE listings DROP COLUMN seller_type');
  await assert.rejects(quiet(() => runScraper(CONFIG)), /این ستون‌ها در دیتابیس نیستند: seller_type/);
});

test('ذخیره‌ی یک ردیف شکست بخورد: بقیه ذخیره می‌شوند و اجرا سبز می‌ماند', async () => {
  seedSource();
  // دومین INSERT روی listings (sqlLog قبل از failD1 پر می‌شود) خطای ۴۰۰ می‌گیرد
  w.failD1 = (sql) => (/^INSERT INTO listings/.test(sql) && writesTo('listings') === 2 ? { status: 400 } : null);
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listings').c, 3);
  assert.match(r.text, /ذخیره‌ی .* شکست خورد/);
  assert.equal(process.exitCode ?? 0, 0);
});

// ── گیرنده‌ها (قابلیت موتور؛ در سیستم نهایی recipients خالی است) ───────────────────
function withRecipients(list, secrets = { r1: 'sek-1' }) {
  const dir = mkdtempSync(join(tmpdir(), 'recips-'));
  const p = join(dir, 'r.json');
  writeFileSync(p, JSON.stringify(list));
  process.env.RECIPIENTS_PATH = p;
  process.env.INGEST_SECRETS_JSON = JSON.stringify(secrets);
}
const R1 = { id: 'r1', category: 'mobile-tablet', worker_url: 'https://r1.test/ingest' };

test('گیرنده‌ی سالم: آگهی با هدر رمز ارسال می‌شود و delivered_to ثبت می‌شود', async () => {
  withRecipients([R1, { id: 'other', category: 'real-estate', worker_url: 'https://x.test/ingest' }]);
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  const pushed = [];
  w.route('https://r1.test/ingest', (u, init) => { pushed.push({ secret: init.headers['X-Ingest-Secret'], body: JSON.parse(init.body) }); return new Response('ok', { status: 200 }); });
  w.route('https://r1.test/heartbeat', () => new Response('ok', { status: 200 }));
  const r = await quiet(() => runScraper(CONFIG));
  assert.match(r.text, /گیرنده‌ها: 1/);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].secret, 'sek-1');
  const l = pushed[0].body.listing;
  assert.equal(l.token, 'P1');
  assert.equal(l.status, 'new');
  for (const k of ['_needsBroadcast', '_delivered', '_skipWrite', 'delivered_to']) assert.ok(!(k in l), `${k} نباید ارسال شود`);
  const row = w.one("SELECT is_broadcasted, broadcast_attempts, delivered_to FROM listings WHERE token = 'P1'");
  assert.deepEqual(row, { is_broadcasted: 1, broadcast_attempts: 0, delivered_to: '["r1"]' });
  assert.ok(w.fetches.some((f) => f.url === 'https://r1.test/heartbeat'));
});

test('گیرنده‌ی خراب (۵۰۰): آگهی برای اجرای بعد می‌ماند و broadcast_attempts بالا می‌رود', async () => {
  withRecipients([R1]);
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  let calls = 0;
  w.route('https://r1.test/ingest', () => { calls++; return new Response('boom', { status: 500 }); });
  w.route('https://r1.test/heartbeat', () => new Response('ok'));
  await quiet(() => runScraper(CONFIG));
  assert.equal(calls, 3); // سه تلاش داخل همین اجرا
  assert.deepEqual(w.one("SELECT is_broadcasted, broadcast_attempts, delivered_to FROM listings WHERE token = 'P1'"), { is_broadcasted: 0, broadcast_attempts: 1, delivered_to: '[]' });
  // اجرای بعد: دوباره تلاش، و این‌بار می‌رسد
  w.routes.length = 0;
  w.route('https://r1.test/ingest', () => new Response('ok', { status: 200 }));
  w.route('https://r1.test/heartbeat', () => new Response('ok'));
  await quiet(() => runScraper(CONFIG));
  assert.deepEqual(w.one("SELECT is_broadcasted, delivered_to, status FROM listings WHERE token = 'P1'"), { is_broadcasted: 1, delivered_to: '["r1"]', status: 'new' });
});

test('رمز اشتباه (۴۰۳): تکرار نمی‌شود و آگهی از صف خارج می‌شود', async () => {
  withRecipients([R1]);
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  let calls = 0;
  w.route('https://r1.test/ingest', () => { calls++; return new Response('no', { status: 403 }); });
  w.route('https://r1.test/heartbeat', () => new Response('ok'));
  const r = await quiet(() => runScraper(CONFIG));
  assert.equal(calls, 1);
  assert.match(r.text, /کلید اشتباه است \(403\)/);
  assert.ok(!r.text.includes('r1.test'), 'آدرس گیرنده نباید در لاگ (مخزن عمومی) چاپ شود');
  assert.equal(w.one("SELECT is_broadcasted FROM listings WHERE token = 'P1'").is_broadcasted, 1);
});

test('رمز گیرنده در INGEST_SECRETS_JSON نیست: رد می‌شود و بدون درخواست', async () => {
  withRecipients([R1], {});
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  const r = await quiet(() => runScraper(CONFIG));
  assert.match(r.text, /کلید INGEST_SECRETS_JSON برای «r1» وجود ندارد/);
  assert.ok(!w.fetches.some((f) => f.url.startsWith('https://r1.test')));
});

test('فایل recipients خراب یا ناموجود: هیچ گیرنده‌ای فعال نیست و جمع‌آوری ادامه دارد', async () => {
  process.env.RECIPIENTS_PATH = '/nonexistent/recipients.json';
  w.addSource('mobile-phones', 'P1', { title: 'اپل iPhone 13' });
  const r = await quiet(() => runScraper(CONFIG));
  assert.match(r.text, /فایل recipients خوانده نشد/);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listings').c, 1);
});

test('فایل recipients/empty.json داخل ریپو آرایه‌ی خالی است', async () => {
  const { readFileSync } = await import('node:fs');
  assert.deepEqual(JSON.parse(readFileSync(new URL('../recipients/empty.json', import.meta.url), 'utf8')), []);
});
