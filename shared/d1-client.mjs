// کلاینت D1 از طریق REST API کلودفلر.
// متغیرهای محیطی: CF_ACCOUNT_ID، CF_API_TOKEN و (برای آیدی دیتابیس) CF_D1_DATABASE_ID.
// هیچ‌یک از این مقدارها هرگز در لاگ یا پیام خطا چاپ نمی‌شوند (scrub).

const MAX_BOUND_PARAMS = 90; // سقف واقعی D1 صد تاست؛ ۹۰ را برای حاشیه‌ی امن گرفتیم
const HARD_PARAM_LIMIT = 100;

const timeoutMs = () => Number(process.env.D1_TIMEOUT_MS || 30000);
const retryBaseMs = () => Number(process.env.D1_RETRY_BASE_MS || 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** هر مقدار حساس را در متن با *** عوض می‌کند. */
export function makeScrubber(secrets) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 4);
  return (text) => {
    let out = String(text ?? '');
    for (const s of list) out = out.split(s).join('***');
    return out;
  };
}

export function makeD1Client(databaseId = process.env.CF_D1_DATABASE_ID) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('CF_ACCOUNT_ID یا CF_API_TOKEN تنظیم نشده — باید در Secrets ریپو باشند.');
  }
  if (!databaseId) {
    throw new Error('آیدی دیتابیس D1 (CF_D1_DATABASE_ID) تنظیم نشده — Secret مربوط به آن را چک کن.');
  }
  const scrub = makeScrubber([apiToken, accountId, databaseId]);
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const stats = { requests: 0, rowsRead: 0, rowsWritten: 0 };

  function hintFor(status, detail) {
    if (/limit|quota|exceed/i.test(detail)) {
      return ' | احتمالاً سقف روزانه‌ی رایگان D1 پر شده (ساعت ۰۰:۰۰ UTC ریست می‌شود)';
    }
    if (status === 401 || status === 403) return ' | CF_API_TOKEN را چک کن (باید دسترسی ویرایش D1 داشته باشد)';
    if (status === 404) return ' | CF_ACCOUNT_ID یا CF_D1_DATABASE_ID اشتباه است';
    return '';
  }

  // خروجی کامل: { results, meta }
  async function exec(sql, params = [], attempt = 1) {
    if (params.length > HARD_PARAM_LIMIT) {
      throw new Error(`خطای برنامه: بیش از ${HARD_PARAM_LIMIT} پارامتر در یک کوئری D1 (${params.length})`);
    }
    let res;
    stats.requests++;
    try {
      res = await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
        // بدون سقف زمانی، یک اتصال گیرکرده می‌تواند دقیقه‌ها اجرا را نگه دارد
        signal: AbortSignal.timeout(timeoutMs()),
      });
    } catch (e) {
      if (attempt < 3) {
        await sleep(attempt * retryBaseMs());
        return exec(sql, params, attempt + 1);
      }
      throw new Error(scrub(`D1 network error: ${e?.message ?? e}`));
    }
    // 429/5xx → تلاش دوباره
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(attempt * retryBaseMs());
      return exec(sql, params, attempt + 1);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const detail = scrub(JSON.stringify(json.errors || json)).slice(0, 300);
      throw new Error(`D1 query failed: ${res.status} | ${detail}${hintFor(res.status, detail)}`);
    }
    const first = json.result?.[0] || {};
    stats.rowsRead += Number(first.meta?.rows_read || 0);
    stats.rowsWritten += Number(first.meta?.rows_written || 0);
    return { results: first.results || [], meta: first.meta || {} };
  }

  async function query(sql, params = []) {
    return (await exec(sql, params)).results;
  }

  // خواندن دسته‌ای با رعایت سقف پارامترهای D1
  async function selectIn(sql_template, values, extraParams = []) {
    const out = [];
    const room = MAX_BOUND_PARAMS - extraParams.length;
    for (let i = 0; i < values.length; i += room) {
      const chunk = values.slice(i, i + room);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await query(sql_template.replace('{{IN}}', placeholders), [...extraParams, ...chunk]);
      out.push(...rows);
    }
    return out;
  }

  return { query, exec, selectIn, stats, scrub };
}

// INSERT ... ON CONFLICT(token) DO UPDATE
// preserveOnConflict: ستون‌هایی که موقع تعارض نباید از مقدار جدید بازنویسی شوند.
export function buildUpsertSQL(tableName, record, columns, preserveOnConflict = []) {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((c) => c !== 'token' && !preserveOnConflict.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const sql =
    `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(token) DO UPDATE SET ${updates}`;
  const params = columns.map((c) => {
    const v = record[c];
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  return { sql, params };
}
