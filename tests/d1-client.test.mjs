import { makeWorld, ENV, CF_QUERY_URL } from './helpers/world.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client, makeScrubber, buildUpsertSQL } from '../shared/d1-client.mjs';

test('scrub: هر مقدار حساس با *** عوض می‌شود و مقدارهای کوتاه نادیده گرفته می‌شوند', () => {
  const scrub = makeScrubber(['secret-token-1', 'abc', undefined, null]);
  assert.equal(scrub('خطا با secret-token-1 و دوباره secret-token-1'), 'خطا با *** و دوباره ***');
  assert.equal(scrub('abc باید بماند'), 'abc باید بماند'); // کمتر از ۴ نویسه: ممکن است بخشی از متن عادی باشد
  assert.equal(scrub(undefined), '');
});

test('buildUpsertSQL: ستون محافظت‌شده بازنویسی نمی‌شود و مقدارها نرمال می‌شوند', () => {
  const { sql, params } = buildUpsertSQL('listings', { token: 't', a: true, b: { x: 1 }, c: undefined, first_seen: 'x' }, ['token', 'a', 'b', 'c', 'first_seen'], ['first_seen']);
  assert.match(sql, /ON CONFLICT\(token\) DO UPDATE SET a = excluded\.a, b = excluded\.b, c = excluded\.c$/);
  assert.ok(!/first_seen = excluded/.test(sql));
  assert.deepEqual(params, ['t', 1, '{"x":1}', null, 'x']);
});

test('makeD1Client: متغیر ناقص پیام روشن می‌دهد', () => {
  const saved = process.env.CF_API_TOKEN;
  delete process.env.CF_API_TOKEN;
  try { assert.throws(() => makeD1Client(), /CF_ACCOUNT_ID یا CF_API_TOKEN/); } finally { process.env.CF_API_TOKEN = saved; }
  assert.throws(() => makeD1Client(''), /CF_D1_DATABASE_ID/);
});

test('query/exec: نتیجه و آمار؛ سقف ۱۰۰ پارامتر پیش از ارسال گرفته می‌شود', async () => {
  const w = makeWorld();
  try {
    const d1 = makeD1Client();
    await d1.query('INSERT INTO bot_settings (key, value) VALUES (?, ?)', ['k', 'v']);
    assert.deepEqual(await d1.query('SELECT key, value FROM bot_settings'), [{ key: 'k', value: 'v' }]);
    const r = await d1.exec('UPDATE bot_settings SET value = ? WHERE key = ?', ['v2', 'k']);
    assert.equal(r.meta.changes, 1);
    assert.equal(d1.stats.requests, 3);
    assert.equal(d1.stats.rowsWritten, 2);
    const before = w.fetches.length;
    await assert.rejects(d1.query('SELECT 1', new Array(101).fill(1)), /بیش از 100 پارامتر/);
    assert.equal(w.fetches.length, before, 'کوئری ناسالم نباید به شبکه برود');
  } finally { w.restore(); }
});

test('selectIn: لیست بلند به دسته‌های ≤۹۰ پارامتر شکسته می‌شود', async () => {
  const w = makeWorld();
  try {
    for (let i = 0; i < 230; i++) w.run('INSERT INTO bot_settings (key, value) VALUES (?, ?)', `k${i}`, String(i));
    const d1 = makeD1Client();
    const keys = Array.from({ length: 230 }, (_, i) => `k${i}`);
    const rows = await d1.selectIn('SELECT key FROM bot_settings WHERE key IN ({{IN}})', keys);
    assert.equal(rows.length, 230);
    assert.equal(d1.stats.requests, 3); // 90 + 90 + 50
    const rows2 = await d1.selectIn('SELECT key FROM bot_settings WHERE value <> ? AND key IN ({{IN}})', keys.slice(0, 100), ['5']);
    assert.equal(rows2.length, 99); // پارامترهای اضافه (extraParams) پیش از مقدارهای IN بسته می‌شوند
  } finally { w.restore(); }
});

test('خطای ۵۰۰ دوباره تلاش می‌شود و بعد موفق می‌شود؛ خطای شبکه هم همین‌طور', async () => {
  const w = makeWorld();
  try {
    let n = 0;
    w.route(CF_QUERY_URL, () => {
      n++;
      if (n === 1) return new Response('boom', { status: 500 });
      if (n === 2) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ success: true, result: [{ results: [{ a: 1 }], meta: {} }] }), { status: 200 });
    });
    const d1 = makeD1Client();
    assert.deepEqual(await d1.query('SELECT 1 AS a'), [{ a: 1 }]);
    assert.equal(n, 3);
  } finally { w.restore(); }
});

test('خطای دائمی: پیام راهنما دارد و هیچ سکرتی در آن نیست', async () => {
  const w = makeWorld();
  try {
    w.route(CF_QUERY_URL, () => new Response(JSON.stringify({ success: false, errors: [{ message: `token ${ENV.CF_API_TOKEN} for ${ENV.CF_ACCOUNT_ID} invalid` }] }), { status: 403 }));
    const d1 = makeD1Client();
    let msg = '';
    await d1.query('SELECT 1').catch((e) => { msg = e.message; });
    assert.match(msg, /D1 query failed: 403/);
    assert.match(msg, /CF_API_TOKEN را چک کن/);
    for (const s of [ENV.CF_API_TOKEN, ENV.CF_ACCOUNT_ID, ENV.CF_D1_DATABASE_ID]) assert.ok(!msg.includes(s), 'سکرت در پیام خطا نشت کرده');
  } finally { w.restore(); }
});

test('پیام خطای سقف روزانه‌ی D1 واضح است', async () => {
  const w = makeWorld();
  try {
    w.route(CF_QUERY_URL, () => new Response(JSON.stringify({ success: false, errors: [{ message: 'Exceeded daily row write limit' }] }), { status: 400 }));
    await assert.rejects(makeD1Client().query('SELECT 1'), /سقف روزانه‌ی رایگان D1/);
  } finally { w.restore(); }
});

test('خطای شبکه‌ی دائمی بعد از سه تلاش با پیام scrub‌شده', async () => {
  const w = makeWorld();
  try {
    let n = 0;
    w.route(CF_QUERY_URL, () => { n++; throw new TypeError(`connect failed ${ENV.CF_API_TOKEN}`); });
    let msg = '';
    await makeD1Client().query('SELECT 1').catch((e) => { msg = e.message; });
    assert.equal(n, 3);
    assert.match(msg, /D1 network error/);
    assert.ok(!msg.includes(ENV.CF_API_TOKEN));
  } finally { w.restore(); }
});
