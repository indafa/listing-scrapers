import { makeWorld } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import { runNews, parseFeed, parseFeedList, normalizeUrl } from '../jobs/news.mjs';

let w;
let d1;
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
beforeEach(() => { w = makeWorld(); d1 = makeD1Client(); });
afterEach(() => w.restore());

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>فید</title>
<item><title><![CDATA[معرفی گوشی <b>جدید</b> &amp; قدرتمند]]></title><link>https://news.test/a?utm_source=x&amp;id=1#top</link>
<description><![CDATA[<p>خلاصه‌ی <i>خبر</i> اول</p><script>alert(1)</script>]]></description><pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>خبر قدیمی</title><link>https://news.test/old</link><description>x</description><pubDate>Mon, 01 Jan 2024 08:00:00 GMT</pubDate></item>
<item><title>بدون لینک</title><description>x</description></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>خبر اتم</title><link rel="alternate" href="https://news.test/atom/1/"/><summary>خلاصه</summary><updated>2026-10-04T08:00:00Z</updated></entry></feed>`;

test('parseFeedList: فقط https، یکتا، حداکثر ۱۰ فید', () => {
  assert.deepEqual(parseFeedList('https://a.test/x, http://insecure.test\nhttps://a.test/x\n\n https://b.test/y '), ['https://a.test/x', 'https://b.test/y']);
  assert.deepEqual(parseFeedList(''), []);
  assert.deepEqual(parseFeedList(null), []);
  assert.equal(parseFeedList(Array.from({ length: 15 }, (_, i) => `https://f${i}.test/`).join(',')).length, 10);
});

test('normalizeUrl: بدون fragment و utm_؛ فقط http/https', () => {
  assert.equal(normalizeUrl('https://news.test/a?utm_source=x&id=1#top'), 'https://news.test/a?id=1');
  assert.equal(normalizeUrl('https://news.test/p/'), 'https://news.test/p');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('ftp://x.test/f'), null);
  assert.equal(normalizeUrl('خراب'), null);
});

test('parseFeed: RSS و Atom؛ تگ، CDATA و موجودیت‌ها پاک می‌شوند (داده‌ی غیرقابل‌اعتماد)', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2, 'آیتم بدون لینک حذف می‌شود');
  assert.equal(items[0].title, 'معرفی گوشی جدید & قدرتمند');
  assert.equal(items[0].url, 'https://news.test/a?id=1');
  assert.ok(!/[<>]/.test(items[0].summary), items[0].summary);
  assert.match(items[0].summary, /^خلاصه‌ی خبر اول/);
  assert.equal(items[0].published, 'Sun, 04 Oct 2026 08:00:00 GMT');
  const atom = parseFeed(ATOM);
  assert.deepEqual(atom.map((x) => [x.title, x.url, x.summary]), [['خبر اتم', 'https://news.test/atom/1', 'خلاصه']]);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
  // سقف طول
  const long = parseFeed(`<rss><item><title>${'ا'.repeat(1000)}</title><link>https://n.test/x</link><description>${'ب'.repeat(5000)}</description></item></rss>`)[0];
  assert.equal(long.title.length, 300);
  assert.equal(long.summary.length, 600);
});

test('پیش‌فرض خاموش: بدون فید هیچ درخواستی زده نمی‌شود', async () => {
  const logs = [];
  const sum = await runNews({ d1, now: NOW, log: (m) => logs.push(m) });
  assert.deepEqual(sum, { feeds: 0, failedFeeds: 0, items: 0, inserted: 0 });
  assert.ok(logs.some((m) => /خاموش/.test(m)));
  assert.ok(!w.fetches.some((f) => !f.url.includes('cloudflare')));
});

test('اجرا: آیتم‌ها خام ذخیره می‌شوند، قدیمی‌ها رد، تکراری‌ها یکی؛ فید خراب کار را خراب نمی‌کند', async () => {
  w.run("INSERT INTO bot_settings (key, value) VALUES ('news_feeds', 'https://f1.test/rss, https://f2.test/atom, https://down.test/x, https://f1.test/rss')");
  w.route('https://f1.test/rss', () => new Response(RSS));
  w.route('https://f2.test/atom', () => new Response(ATOM + ''));
  w.route('https://down.test/x', () => new Response('x', { status: 503 }));
  const r = await quiet(() => runNews({ d1, now: NOW, log: () => {} }));
  assert.deepEqual(r.result, { feeds: 3, failedFeeds: 1, items: 2, inserted: 2 });
  const rows = w.rows('SELECT url, title, processed, fetched_at FROM tech_news_raw ORDER BY url');
  assert.deepEqual(rows.map((x) => x.url), ['https://news.test/a?id=1', 'https://news.test/atom/1']);
  assert.ok(rows.every((x) => x.processed === 0 && x.fetched_at === NOW));

  // اجرای دوم: چیز تازه‌ای نیست
  const again = await quiet(() => runNews({ d1, now: NOW + 1000, log: () => {} }));
  assert.equal(again.result.inserted, 0);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM tech_news_raw').c, 2);
});

test('فید شبکه‌اش قطع باشد: بدون استثنا و بدون ردیف', async () => {
  w.run("INSERT INTO bot_settings (key, value) VALUES ('news_feeds', 'https://net.test/x')");
  w.route('https://net.test/x', () => { throw new TypeError('network down'); });
  const sum = (await quiet(() => runNews({ d1, now: NOW, log: () => {} }))).result;
  assert.deepEqual([sum.failedFeeds, sum.inserted], [1, 0]);
});
