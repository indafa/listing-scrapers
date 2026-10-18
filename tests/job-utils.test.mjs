import { makeWorld, ENV, CF_QUERY_URL, resetExit } from './helpers/world.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import {
  chunk, placeholders, isoAgo, sha1, parseJsonArray, getSettings, upsertMany, insertIgnoreMany, requireEnv, runJob, HOUR, isMain,
} from '../shared/job-utils.mjs';

test('chunk / placeholders / isoAgo / sha1 / parseJsonArray', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([]), []);
  assert.equal(chunk(Array.from({ length: 181 }, (_, i) => i)).length, 3); // پیش‌فرض ۹۰
  assert.equal(placeholders(3), '?,?,?');
  assert.equal(isoAgo(Date.parse('2026-01-02T00:00:00.000Z'), 24), '2026-01-01T00:00:00.000Z');
  assert.equal(sha1('a'), '86f7e437faa5a7fce15d1ddcb9eaeaea377667b8');
  assert.deepEqual(parseJsonArray('[1,2]'), [1, 2]);
  assert.deepEqual(parseJsonArray('{"a":1}'), []);
  assert.deepEqual(parseJsonArray('خراب'), []);
  assert.deepEqual(parseJsonArray(null), []);
  assert.equal(HOUR, 3_600_000);
});

test('getSettings: فقط کلیدهای موجود برمی‌گردند', async () => {
  const w = makeWorld();
  try {
    w.run("INSERT INTO bot_settings (key, value) VALUES ('a', '1'), ('b', '2')");
    const d1 = makeD1Client();
    assert.deepEqual(await getSettings(d1, ['a', 'zzz']), { a: '1' });
    assert.deepEqual(await getSettings(d1, []), {});
  } finally { w.restore(); }
});

test('upsertMany: دسته‌بندی بر اساس سقف پارامتر، به‌روزرسانی در تعارض و شرط WHERE', async () => {
  const w = makeWorld();
  try {
    const d1 = makeD1Client();
    const rows = Array.from({ length: 70 }, (_, i) => ({ token: `T${i}`, is_active: 1, checked_at: i, closed_reason: null, last_price: 100 + i }));
    const cols = ['token', 'is_active', 'checked_at', 'closed_reason', 'last_price'];
    const r = await upsertMany(d1, { table: 'listing_state', columns: cols, rows, conflict: 'token' });
    assert.deepEqual([r.written, r.failed], [70, 0]);
    assert.equal(d1.stats.requests, 4); // ۱۸ ردیف × ۵ ستون = ۹۰ پارامتر در هر دسته
    assert.equal(w.one('SELECT COUNT(*) AS c FROM listing_state').c, 70);

    // تعارض → به‌روزرسانی
    await upsertMany(d1, { table: 'listing_state', columns: cols, rows: [{ ...rows[0], is_active: 0, closed_reason: 'sold' }], conflict: 'token' });
    assert.deepEqual(w.one("SELECT is_active, closed_reason FROM listing_state WHERE token = 'T0'"), { is_active: 0, closed_reason: 'sold' });

    // شرط WHERE: ردیفی که شرط را ندارد دست‌نخورده می‌ماند
    await upsertMany(d1, { table: 'listing_state', columns: cols, rows: [{ ...rows[1], last_price: 1 }], conflict: 'token', where: 'listing_state.is_active = 0' });
    assert.equal(w.one("SELECT last_price FROM listing_state WHERE token = 'T1'").last_price, 101);
  } finally { w.restore(); }
});

test('upsertMany: ردیف خراب بقیه‌ی دسته را نمی‌برد', async () => {
  const w = makeWorld();
  try {
    const d1 = makeD1Client();
    // هر ردیف token (کلید اصلی) دارد؛ ردیف دوم کلید خالی نمی‌شود، پس خطا را با شکست تزریقی می‌سازیم
    w.failD1 = (sql) => (/VALUES \(\?, \?, \?, \?, \?\), \(/.test(sql) ? { status: 400 } : null);
    const cols = ['token', 'is_active', 'checked_at', 'closed_reason', 'last_price'];
    const rows = [1, 2, 3].map((i) => ({ token: `X${i}`, is_active: 1, checked_at: i, closed_reason: null, last_price: i }));
    const r = await upsertMany(d1, { table: 'listing_state', columns: cols, rows, conflict: 'token' });
    assert.deepEqual([r.written, r.failed], [3, 0], 'دسته شکست خورد ولی تک‌تک ردیف‌ها نوشته شدند');
    assert.equal(w.one('SELECT COUNT(*) AS c FROM listing_state').c, 3);

    w.failD1 = (sql) => (/INTO listing_state/.test(sql) ? { status: 400 } : null);
    const r2 = await upsertMany(d1, { table: 'listing_state', columns: cols, rows: [{ token: 'Y' }], conflict: 'token' });
    assert.deepEqual([r2.written, r2.failed], [0, 1]);
    assert.equal(r2.errors.length, 1);
    assert.deepEqual(await upsertMany(d1, { table: 'listing_state', columns: cols, rows: [], conflict: 'token' }), { written: 0, failed: 0, errors: [] });
  } finally { w.restore(); }
});

test('insertIgnoreMany: ردیف تکراری نادیده گرفته می‌شود', async () => {
  const w = makeWorld();
  try {
    const d1 = makeD1Client();
    const cols = ['token', 'model_id'];
    await insertIgnoreMany(d1, { table: 'model_tokens', columns: cols, rows: [{ token: 'a', model_id: 'm' }, { token: 'b', model_id: 'm' }] });
    await insertIgnoreMany(d1, { table: 'model_tokens', columns: cols, rows: [{ token: 'a', model_id: 'm' }, { token: 'c', model_id: 'm' }] });
    assert.equal(w.one('SELECT COUNT(*) AS c FROM model_tokens').c, 3);
    assert.equal(await insertIgnoreMany(d1, { table: 'model_tokens', columns: cols, rows: [] }), 0);
  } finally { w.restore(); }
});

test('requireEnv: همه‌ی نام‌های خالی را یکجا می‌گوید', () => {
  assert.throws(() => requireEnv(['A', 'B', 'C'], { A: 'x', B: '  ' }), /B، C/);
  assert.doesNotThrow(() => requireEnv(['A'], { A: 'x' }));
});

test('runJob: موفق → خلاصه برمی‌گردد؛ خطا → کد خروج ۱ و پیام بدون سکرت', async () => {
  const w = makeWorld();
  const errs = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a) => errs.push(a.join(' '));
  console.log = () => {};
  try {
    const ok = await runJob('t1', async ({ d1, log }) => { await d1.query('SELECT 1'); log('x'); return { n: 1 }; });
    assert.deepEqual(ok, { n: 1 });
    assert.equal(process.exitCode ?? 0, 0);

    const bad = await runJob('t2', async () => { throw new Error(`خطا با ${ENV.CF_API_TOKEN}`); });
    assert.equal(bad, null);
    assert.equal(process.exitCode, 1);
    assert.match(errs.join('\n'), /❌ t2/);
    assert.ok(!errs.join('\n').includes(ENV.CF_API_TOKEN));
    resetExit();

    const missing = await runJob('t3', async () => 1, { env: { ...ENV, CF_API_TOKEN: '' } });
    assert.equal(missing, null);
    assert.equal(process.exitCode, 1);
    assert.match(errs.join('\n'), /CF_API_TOKEN/);
    resetExit();

    const needExtra = await runJob('t4', async () => 1, { extraEnv: ['SOURCE_DETAIL_URL_BASE'], env: { ...ENV, SOURCE_DETAIL_URL_BASE: '' } });
    assert.equal(needExtra, null);
    assert.match(errs.join('\n'), /SOURCE_DETAIL_URL_BASE/);
    resetExit();
  } finally { console.error = origErr; console.log = origLog; resetExit(); w.restore(); }
});

test('isMain: برای آدرسی که فایل اجراشده نیست نادرست است', () => {
  assert.equal(isMain('file:///nonexistent.mjs'), false);
});
