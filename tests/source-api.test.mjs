import { makeWorld, ENV, detail } from './helpers/world.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTokens, fetchDetail, sourceLink, safeSnippet } from '../shared/source-api.mjs';

const withoutEnv = async (name, fn) => {
  const saved = process.env[name];
  delete process.env[name];
  try { return await fn(); } finally { process.env[name] = saved; }
};

test('sourceLink: توکن را کدگذاری می‌کند و بدون پایه null می‌دهد', async () => {
  assert.equal(sourceLink('abc'), 'https://source.test/v/abc');
  assert.equal(sourceLink('a/b c'), 'https://source.test/v/a%2Fb%20c');
  assert.equal(sourceLink(''), null);
  await withoutEnv('SOURCE_LINK_BASE', () => assert.equal(sourceLink('abc'), null));
});

test('searchTokens: ستون category با storeAs پر می‌شود نه searchSlug؛ تکراری‌ها حذف می‌شوند', async () => {
  const w = makeWorld();
  try {
    w.addSource('mobile-phones', 'A', { title: 'یک' });
    w.addSource('mobile-phones', 'B', { title: 'دو' });
    w.source.search['mobile-phones'].push('A'); // تکراری
    const out = await searchTokens('mobile-phones', 'stored-name', '4');
    assert.deepEqual(out.map((x) => x.token), ['A', 'B']);
    assert.ok(out.every((x) => x.category === 'stored-name'));
    assert.equal(out[0].title, 'یک');
    assert.equal(out[0].district_persian, 'چهارباغ');
    // بدنه‌ی درخواست: شهر، مرتب‌سازی بر اساس تاریخ
    const body = w.source.searchBody;
    assert.deepEqual(body.city_ids, ['4']);
    assert.equal(body.search_data.server_payload.additional_form_data.data.sort.str.value, 'sort_date');
    assert.equal(body.search_data.form_data.data.category.str.value, 'mobile-phones');
  } finally { w.restore(); }
});

test('searchTokens: ویجت بدون توکن رد می‌شود و ساختار خالی خطا نیست', async () => {
  const w = makeWorld();
  try {
    w.route(ENV.SOURCE_SEARCH_URL, () => new Response(JSON.stringify({ list_widgets: [{ data: {} }, {}, { data: { token: 'Z', title: 't' } }] }), { status: 200 }));
    assert.deepEqual((await searchTokens('x', 'x', 4)).map((t) => t.token), ['Z']);
    w.route(ENV.SOURCE_SEARCH_URL, () => new Response('{}', { status: 200 }));
    assert.deepEqual(await searchTokens('x', 'x', 4), []);
  } finally { w.restore(); }
});

test('آدرس‌ها فقط از متغیر می‌آیند و باید https باشند', async () => {
  const w = makeWorld();
  try {
    await withoutEnv('SOURCE_SEARCH_URL', () => assert.rejects(searchTokens('x', 'x', 4), /SOURCE_SEARCH_URL تنظیم نشده/));
    await withoutEnv('SOURCE_DETAIL_URL_BASE', () => assert.rejects(fetchDetail('a'), /SOURCE_DETAIL_URL_BASE تنظیم نشده/));
    const saved = process.env.SOURCE_SEARCH_URL;
    process.env.SOURCE_SEARCH_URL = 'http://plain.test/s';
    try { await assert.rejects(searchTokens('x', 'x', 4), /https:\/\//); } finally { process.env.SOURCE_SEARCH_URL = saved; }
  } finally { w.restore(); }
});

test('fetchDetail: موفق، ۴۰۴ با status روی خطا، ۵۰۰ دوباره تلاش', async () => {
  const w = makeWorld();
  try {
    w.source.listings.set('A', { title: 'x' });
    const raw = await fetchDetail('A');
    assert.ok(Array.isArray(raw.sections));
    const err = await fetchDetail('missing').catch((e) => e);
    assert.equal(err.status, 404);
    assert.match(err.message, /HTTP_404/);

    let n = 0;
    w.route(`${ENV.SOURCE_DETAIL_URL_BASE}/flaky`, () => (++n < 3 ? new Response('x', { status: 503, headers: { 'retry-after': '0' } }) : new Response(JSON.stringify(detail({ token: 'flaky' })), { status: 200 })));
    assert.ok((await fetchDetail('flaky')).webengage);
    assert.equal(n, 3);
  } finally { w.restore(); }
});

test('پاسخ HTML (بلاک/کپچا) خطای روشن با نشانگر notJson می‌دهد', async () => {
  const w = makeWorld();
  try {
    w.source.detailStatus.set('cap', 'html');
    const e = await fetchDetail('cap').catch((x) => x);
    assert.equal(e.notJson, true);
    assert.match(e.message, /JSON نبود/);
  } finally { w.restore(); }
});

test('۴۲۹ و ۵۰۰ دائمی بعد از چند تلاش خطا می‌دهد و تعداد تلاش‌ها محدود است', async () => {
  const w = makeWorld();
  const origErr = console.error;
  console.error = () => {};
  try {
    let n = 0;
    w.route(`${ENV.SOURCE_DETAIL_URL_BASE}/limited`, () => { n++; return new Response('slow down', { status: 429 }); });
    const e = await fetchDetail('limited').catch((x) => x);
    assert.equal(n, 4);
    assert.equal(e.status, 429);
  } finally { console.error = origErr; w.restore(); }
});

test('خطای شبکه چند بار تلاش می‌شود و سپس NETWORK می‌دهد', async () => {
  const w = makeWorld();
  try {
    let n = 0;
    w.route(`${ENV.SOURCE_DETAIL_URL_BASE}/down`, () => { n++; throw new TypeError('fetch failed'); });
    await assert.rejects(fetchDetail('down'), /NETWORK/);
    assert.equal(n, 4);
  } finally { w.restore(); }
});

test('safeSnippet: لاگ عمومی هرگز HTML، متن فارسی یا نام میزبان منبع را چاپ نمی‌کند', () => {
  assert.equal(safeSnippet(''), '(بدون بدنه)');
  assert.match(safeSnippet('<html><title>x</title></html>'), /HTML/);
  assert.match(safeSnippet('{"message":"متن فارسی"}'), /غیرانگلیسی/);
  const saved = process.env.SOURCE_SEARCH_URL;
  process.env.SOURCE_SEARCH_URL = 'https://api.mysource.example/v8/search';
  try {
    assert.equal(safeSnippet('{"error":"blocked by mysource gateway"}'), '{"error":"blocked by *** gateway"}');
  } finally { process.env.SOURCE_SEARCH_URL = saved; }
  assert.equal(safeSnippet('x'.repeat(500), 50).length, 50);
});
