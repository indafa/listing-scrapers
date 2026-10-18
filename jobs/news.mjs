// کار news (هفتگی؛ پیش‌فرض خاموش): آدرس فیدهای RSS/Atom را از bot_settings.news_feeds می‌خواند
// (جداشده با ویرگول یا خط جدید؛ پیش‌فرض خالی = هیچ‌کاری نمی‌کند) و آیتم‌های خام را در tech_news_raw می‌ریزد.
// خلاصه‌سازی و انتشار با Worker است. متن فید «داده‌ی غیرقابل‌اعتماد» است: تگ‌ها حذف و طول‌ها محدود می‌شوند.
// در دسترس نبودن فید هرگز کار را خراب نمی‌کند. کلید یکتا: آدرس نرمال‌شده‌ی خبر (ستون url کلید اصلی است).
import { getSettings, insertIgnoreMany, runJob, isMain } from '../shared/job-utils.mjs';

const MAX_FEEDS = 10;
const MAX_ITEMS_PER_FEED = 30;
const MAX_BYTES = 1_500_000;
const MAX_AGE_DAYS = 30;

export function parseFeedList(value) {
  const seen = new Set();
  const out = [];
  for (const part of String(value ?? '').split(/[\n,]+/)) {
    const u = part.trim();
    if (!/^https:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out.slice(0, MAX_FEEDS);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d) || 32))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const clean = (s, max) => decode(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ').trim().slice(0, max);
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

/** آدرس خبر را یکدست می‌کند (بدون fragment و پارامترهای utm_) */
export function normalizeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** RSS 2.0 و Atom را بدون وابستگی پارس می‌کند. */
export function parseFeed(xml) {
  const items = [];
  const text = String(xml ?? '').slice(0, MAX_BYTES);
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = clean(tag(b, 'link'), 600);
    if (!link) {
      const m = b.match(/<link[^>]*\shref=["']([^"']+)["']/i);
      link = m ? decode(m[1]) : clean(tag(b, 'guid') || tag(b, 'id'), 600);
    }
    const url = normalizeUrl(link);
    const title = clean(tag(b, 'title'), 300);
    if (!url || !title) continue;
    items.push({
      url, title,
      summary: clean(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'), 600),
      published: clean(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'), 60) || null,
    });
  }
  return items;
}

export async function runNews({ d1, now = Date.now(), log = console.log } = {}) {
  const sum = { feeds: 0, failedFeeds: 0, items: 0, inserted: 0 };
  const s = await getSettings(d1, ['news_feeds']);
  const feeds = parseFeedList(s.news_feeds);
  if (!feeds.length) {
    log('ℹ️  news — فهرست فید خالی است (پیش‌فرض خاموش)؛ کاری انجام نشد.');
    return sum;
  }
  const byUrl = new Map();
  for (const feed of feeds) {
    sum.feeds++;
    try {
      const res = await fetch(feed, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text()).slice(0, MAX_ITEMS_PER_FEED);
      for (const it of items) {
        const t = it.published ? Date.parse(it.published) : NaN;
        if (Number.isFinite(t) && now - t > MAX_AGE_DAYS * 86_400_000) continue;
        if (!byUrl.has(it.url)) byUrl.set(it.url, it);
      }
    } catch (e) {
      sum.failedFeeds++;
      log(`⚠️  news — فید ${sum.feeds} در دسترس نبود (${String(e?.message ?? e).slice(0, 60)})؛ رد شد.`);
    }
  }
  sum.items = byUrl.size;
  const rows = [...byUrl.values()].map((it) => ({ url: it.url, title: it.title, summary: it.summary, published: it.published, fetched_at: now, processed: 0 }));
  const before = (await d1.query('SELECT COUNT(*) AS c FROM tech_news_raw'))[0]?.c ?? 0;
  await insertIgnoreMany(d1, { table: 'tech_news_raw', columns: ['url', 'title', 'summary', 'published', 'fetched_at', 'processed'], rows });
  const after = (await d1.query('SELECT COUNT(*) AS c FROM tech_news_raw'))[0]?.c ?? 0;
  sum.inserted = Number(after) - Number(before);
  log(`✅ news — فید ${sum.feeds} (ناموفق ${sum.failedFeeds}) | آیتم ${sum.items} | تازه ذخیره‌شده ${sum.inserted}`);
  return sum;
}

if (isMain(import.meta.url)) await runJob('news', (ctx) => runNews(ctx));
