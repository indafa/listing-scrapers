// ارتباط با API عمومی منبع آگهی — جست‌وجو و گرفتن جزئیات آگهی.
// همه‌ی آدرس‌ها از متغیرهای ریپو (Variables) می‌آیند؛ هیچ آدرسی در کد نیست:
//   SOURCE_SEARCH_URL       آدرس کامل جست‌وجو (POST)
//   SOURCE_DETAIL_URL_BASE  پیشوند آدرس جزئیات؛ توکن آگهی بعد از آن (با یک «/») اضافه می‌شود
//   SOURCE_LINK_BASE        پیشوند لینک عمومی آگهی؛ توکن بعد از آن اضافه می‌شود

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const timeoutMs = () => Number(process.env.SOURCE_TIMEOUT_MS || 30000);
const retryUnitMs = () => Number(process.env.SOURCE_RETRY_UNIT_MS || 1000); // هر «۱» = یک ثانیه (در تست کوچک‌تر می‌شود)
const maxRetryWaitMs = () => 60 * retryUnitMs();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * خلاصه‌ی بی‌خطر از متن پاسخ منبع برای لاگ. لاگ‌های Actions در مخزن عمومی برای همه دیده می‌شوند؛
 * پس HTML هرگز چاپ نمی‌شود، متنی که حروف غیرانگلیسی دارد هم چاپ نمی‌شود،
 * و اگر بخشی از نام میزبانِ آدرس‌های تنظیم‌شده در متن باشد با *** پوشانده می‌شود.
 */
export function safeSnippet(text, max = 120) {
  const t = String(text ?? '').trim();
  if (!t) return '(بدون بدنه)';
  if (t.startsWith('<')) return '(پاسخ HTML؛ متن آن عمداً چاپ نمی‌شود)';
  if (/[^\x20-\x7E\r\n\t]/.test(t.slice(0, max))) return '(پاسخ شامل متن غیرانگلیسی؛ عمداً چاپ نمی‌شود)';
  let s = t.replace(/\s+/g, ' ').slice(0, max);
  for (const name of ['SOURCE_SEARCH_URL', 'SOURCE_DETAIL_URL_BASE', 'SOURCE_LINK_BASE']) {
    let host = '';
    try { host = new URL(process.env[name] || '').hostname; } catch { /* تنظیم نشده */ }
    for (const part of host.split('.')) {
      if (part.length < 3 || ['www', 'api', 'com', 'net', 'org', 'app'].includes(part)) continue;
      s = s.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
    }
  }
  return s;
}

/** مقدار یک متغیر آدرس را می‌خواند و https بودنش را چک می‌کند. */
function urlFromEnv(name) {
  const v = (process.env[name] || '').trim();
  if (!v) {
    throw new Error(`${name} تنظیم نشده — آن را در Settings ← Secrets and variables ← Actions ← Variables وارد کن.`);
  }
  if (!/^https:\/\//i.test(v)) {
    throw new Error(`${name} باید با https:// شروع شود.`);
  }
  return v;
}

const joinUrl = (base, token) => `${base.replace(/\/+$/, '')}/${encodeURIComponent(token)}`;

/** لینک عمومی آگهی؛ اگر SOURCE_LINK_BASE تنظیم نباشد null برمی‌گرداند. */
export function sourceLink(token) {
  const base = (process.env.SOURCE_LINK_BASE || '').trim();
  return token && base ? joinUrl(base, token) : null;
}

async function fetchWithRetry(url, options, label, maxAttempts = 4) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      // بدون سقف زمانی، یک اتصال گیرکرده تا ۵ دقیقه اجرا را نگه می‌دارد
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs()) });
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await sleep(attempt * 3 * retryUnitMs());
        continue;
      }
      throw new Error(`NETWORK برای ${label}: ${e.message}`, { cause: e });
    }
    if (res.status === 429 || res.status >= 500) {
      // Retry-After ممکن است عدد ثانیه یا تاریخ باشد؛ در هر حالت سقف ۶۰ ثانیه
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, maxRetryWaitMs())
        : attempt * 4 * retryUnitMs();
      if (attempt < maxAttempts) {
        console.error(`⏳ ${res.status} برای ${label} — تلاش ${attempt}/${maxAttempts}، ${Math.round(wait / 1000)}s صبر...`);
        await sleep(wait);
        continue;
      }
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(بدون بدنه)');
      const err = new Error(`HTTP_${res.status} برای ${label} | بدنه: ${safeSnippet(bodyText, 200)}`);
      err.status = res.status; // برای کار زنده‌بودن آگهی (۴۰۴ یعنی حذف‌شده)
      throw err;
    }
    return res;
  }
  throw lastErr || new Error(`تلاش‌ها برای ${label} تمام شد`);
}

// وقتی منبع به‌جای JSON صفحه‌ی HTML (بلاک/کپچا) می‌دهد، خطای «Unexpected token <» گمراه‌کننده است
async function readJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(`پاسخ منبع برای ${label} JSON نبود (احتمالاً بلاک یا کپچا) | شروع پاسخ: ${safeSnippet(text, 120)}`);
    err.notJson = true;
    throw err;
  }
}

/**
 * جست‌وجوی صفحه‌ی اول یک دسته، مرتب‌شده بر اساس تاریخ.
 * @param {string} searchSlug  اسلاگی که منبع در جست‌وجو می‌شناسد (مثلاً mobile-phones)
 * @param {string} storeAs     مقداری که باید در ستون category ذخیره شود
 */
export async function searchTokens(searchSlug, storeAs, cityId) {
  const searchUrl = urlFromEnv('SOURCE_SEARCH_URL');
  const body = {
    city_ids: [String(cityId)],
    disable_recommendation: false,
    map_state: { camera_info: { bbox: {} } },
    search_data: {
      form_data: { data: { category: { str: { value: searchSlug } } } },
      server_payload: {
        '@type': 'type.googleapis.com/widgets.SearchData.ServerPayload',
        additional_form_data: { data: { sort: { str: { value: 'sort_date' } } } },
      },
    },
  };
  const res = await fetchWithRetry(
    searchUrl,
    { method: 'POST', headers: HEADERS, body: JSON.stringify(body) },
    `search:${searchSlug}`
  );
  const json = await readJson(res, `search:${searchSlug}`);
  const tokens = [];
  const seen = new Set();
  for (const widget of json?.list_widgets || []) {
    const data = widget?.data;
    if (!data) continue;
    const token = data.action?.payload?.token || data.token;
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push({
      token,
      title: data.title || '',
      district_persian: data.district || '',
      // 🔴 نکته‌ی حیاتی: این مقدار همانی است که در ستون category ذخیره می‌شود و
      // بعداً کوئری‌ها بر اساسش کار می‌کنند. حتماً storeAs، نه searchSlug.
      category: storeAs,
    });
  }
  return tokens;
}

export async function fetchDetail(token) {
  const base = urlFromEnv('SOURCE_DETAIL_URL_BASE');
  const res = await fetchWithRetry(joinUrl(base, token), { headers: HEADERS }, `detail:${token}`);
  return readJson(res, `detail:${token}`);
}
