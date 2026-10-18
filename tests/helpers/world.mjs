// دنیای آزمایشی: یک D1 درون‌حافظه (node:sqlite با همان ساختار جدول‌های Worker) + یک «شبکه‌ی جعلی».
// هر `fetch` ریپو (REST کلودفلر، منبع آگهی، فید خبر) به همین‌جا می‌رسد؛ هیچ درخواست واقعی‌ای زده نمی‌شود.
// این فایل باید «اولین» import هر تست باشد: متغیرهای محیطی را همان لحظه‌ی بارگذاری می‌گذارد
// (بعضی ماژول‌ها مقدارشان را موقع import می‌خوانند).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const ENV = {
  CF_ACCOUNT_ID: 'acc-test-123456',
  CF_API_TOKEN: 'tok-secret-abcdef',
  CF_D1_DATABASE_ID: 'db-test-7890ab',
  SOURCE_SEARCH_URL: 'https://source.test/search',
  SOURCE_DETAIL_URL_BASE: 'https://source.test/detail',
  SOURCE_LINK_BASE: 'https://source.test/v',
  SOURCE_CITY_ID: '4',
  SOURCE_CITY_NAME: 'اصفهان',
  REQUEST_SPACING_MS: '0',
  D1_RETRY_BASE_MS: '1',
  SOURCE_RETRY_UNIT_MS: '1',
  PUSH_RETRY_BASE_MS: '1',
  LIVENESS_MIN_RECHECK_MINUTES: '90',
};
Object.assign(process.env, ENV);
delete process.env.RECIPIENTS_PATH;
delete process.env.INGEST_SECRETS_JSON;

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
export const CF_QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ENV.CF_ACCOUNT_ID}/d1/database/${ENV.CF_D1_DATABASE_ID}/query`;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/**
 * @returns {{
 *  db: DatabaseSync, fetches: Array<{url:string, method:string, body:any}>, sqlLog: string[],
 *  routes: Array<{match:(url:string, init:any)=>boolean, handler:(url:string, init:any)=>Response|Promise<Response>}>,
 *  route: Function, restore: () => void, rows: Function, one: Function, run: Function,
 *  source: any, failD1: null | ((sql:string)=>null|{status:number, body?:any}),
 * }}
 */
export function makeWorld() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const world = {
    db, fetches: [], sqlLog: [], routes: [], failD1: null, writes: 0,
    // منبع آگهی‌ها: token → گزینه‌های detail() ؛ search[slug] → فهرست توکن‌ها
    source: { listings: new Map(), search: {}, searchStatus: null, detailStatus: new Map(), searchBody: null },
  };
  const realFetch = globalThis.fetch;

  const cfHandler = async (init) => {
    const { sql, params = [] } = JSON.parse(init.body);
    world.sqlLog.push(sql);
    if (init.headers?.Authorization !== `Bearer ${ENV.CF_API_TOKEN}`) return json({ success: false, errors: [{ message: 'bad token' }] }, 403);
    if (params.length > 100) return json({ success: false, errors: [{ message: 'too many SQL variables' }] }, 400);
    const injected = world.failD1?.(sql);
    if (injected) return json(injected.body ?? { success: false, errors: [{ message: 'injected failure' }] }, injected.status);
    try {
      const st = db.prepare(sql);
      if (/^\s*(select|with|pragma)/i.test(sql)) {
        const results = st.all(...params).map((r) => ({ ...r }));
        return json({ success: true, result: [{ results, meta: { rows_read: results.length, rows_written: 0, changes: 0 } }] });
      }
      const r = st.run(...params);
      world.writes += Number(r.changes);
      return json({ success: true, result: [{ results: [], meta: { rows_read: 0, rows_written: Number(r.changes), changes: Number(r.changes) } }] });
    } catch (e) {
      return json({ success: false, errors: [{ message: String(e.message) }] }, 400);
    }
  };

  const sourceSearch = async (init) => {
    const body = JSON.parse(init.body);
    world.source.searchBody = body;
    if (world.source.searchStatus) return new Response('blocked', { status: world.source.searchStatus });
    const slug = body?.search_data?.form_data?.data?.category?.str?.value;
    const tokens = world.source.search[slug] ?? [];
    return json({
      list_widgets: tokens.map((t) => ({ data: { title: world.source.listings.get(t)?.title ?? 'آگهی', district: 'چهارباغ', action: { payload: { token: t } } } })),
    });
  };

  const sourceDetail = async (url) => {
    const token = decodeURIComponent(url.slice(`${ENV.SOURCE_DETAIL_URL_BASE}/`.length));
    const forced = world.source.detailStatus.get(token) ?? world.source.detailStatus.get('*');
    if (forced === 'html') return new Response('<html><body>captcha</body></html>', { status: 200 });
    if (forced) return new Response('err', { status: forced });
    const o = world.source.listings.get(token);
    if (!o) return new Response('not found', { status: 404 });
    return json(typeof o === 'function' ? o() : o.__raw ?? detail({ token, ...o }));
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    world.fetches.push({ url, method, body });
    for (let i = world.routes.length - 1; i >= 0; i--) {
      const r = world.routes[i];
      if (r.match(url, init)) return r.handler(url, init);
    }
    if (url === CF_QUERY_URL) return cfHandler(init);
    if (url === ENV.SOURCE_SEARCH_URL) return sourceSearch(init);
    if (url.startsWith(`${ENV.SOURCE_DETAIL_URL_BASE}/`)) return sourceDetail(url);
    throw new Error(`درخواست پیش‌بینی‌نشده در تست: ${method} ${url}`);
  };

  world.route = (match, handler) => {
    const m = typeof match === 'string' ? (u) => u === match : match instanceof RegExp ? (u) => match.test(u) : match;
    world.routes.push({ match: m, handler });
  };
  world.restore = () => { globalThis.fetch = realFetch; db.close(); };
  world.rows = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
  world.one = (sql, ...p) => world.rows(sql, ...p)[0] ?? null;
  world.run = (sql, ...p) => db.prepare(sql).run(...p);
  /** افزودن آگهی به منبع جعلی (جست‌وجو و جزئیات) */
  world.addSource = (slug, token, opts = {}) => {
    world.source.listings.set(token, opts);
    (world.source.search[slug] ??= []).push(token);
  };
  return world;
}

/**
 * پاسخ جزئیات آگهی با همان ساختار ویجتی که parseDetails می‌خواند.
 * ⚠️ شکل پاسخ واقعی منبع در این ساندباکس راستی‌آزمایی نشده؛ این ساختار از روی همان کد پارسر ساخته شده.
 */
export function detail(o = {}) {
  const x = {
    token: 'tok1', title: 'اپل iPhone 13 ۱۲۸ گیگابایت', price: 18_500_000, condition: 'کارکرده', storage: '۱۲۸ گیگابایت', ram: '۴ گیگابایت',
    color: 'مشکی', brandModel: 'Apple iPhone 13', description: 'سالم و تمیز، بدون خط و خش', battery: null, bodyCond: null, screenCond: null,
    status_en: 'published', business: 'personal', neighborhood: 'چهارباغ', unavailable_after: null, tablet: false, images: 5, ...o,
  };
  const row = (title, value) => ({ widget_type: 'UNEXPANDABLE_ROW', data: { title, value } });
  const modal = [];
  if (x.battery) modal.push(row('سلامت باتری', x.battery));
  if (x.bodyCond) modal.push(row('وضعیت بدنه', x.bodyCond));
  if (x.screenCond) modal.push(row('وضعیت صفحه‌نمایش', x.screenCond));
  const widgets = [
    { widget_type: 'LEGEND_TITLE_ROW', data: { title: x.title } },
    { widget_type: 'EXPANDABLE_SECTION', data: { title: `در اصفهان، ${x.neighborhood}` } },
    row('قیمت', x.price ? `${x.price.toLocaleString('en-US')} تومان` : 'توافقی'),
    row('وضعیت', x.condition),
    row('حافظهٔ داخلی', x.storage),
    row('مقدار رم', x.ram),
    row('رنگ', x.color),
    { widget_type: 'DESCRIPTION_ROW', data: { text: x.description } },
  ].filter((w) => !(w.data.value === undefined && w.widget_type === 'UNEXPANDABLE_ROW'));
  if (modal.length) {
    widgets.push({ widget_type: 'SELECTOR_ROW', data: { action: { type: 'LOAD_MODAL_PAGE', payload: { modal_page: { widget_list: modal } } } } });
  }
  return {
    sections: [{ widgets }],
    webengage: {
      price: x.price, status: x.status_en, business_type: x.business, district: 'chaharbagh', image_count: x.images,
      brand_model: x.brandModel, cat_3: x.tablet ? 'tablet' : 'mobile-phones',
    },
    seo: x.unavailable_after ? { unavailable_after: x.unavailable_after } : {},
  };
}

/** ردیف listings با مقدارهای پیش‌فرض معقول (برای کارهایی که از D1 می‌خوانند) */
export function listingRow(o = {}) {
  const now = o.now ?? Date.now();
  const iso = (h) => new Date(now - h * 3_600_000).toISOString();
  const r = {
    token: 'L1', title: 'اپل iPhone 13 ۱۲۸ گیگابایت', category: 'mobile-phones', link: 'https://source.test/v/L1', status: 'new',
    device_condition: 'کارکرده', brand_model: 'Apple iPhone 13', internal_storage: 128, ram: 4, color: 'مشکی', price: 18_500_000,
    price_note: null, seller_type: 'شخصی', neighborhood: 'چهارباغ', description: 'سالم و تمیز', is_broadcasted: 1, broadcast_attempts: 0,
    delivered_to: '[]', specs_text: 'price:18500000', first_seen: iso(o.ageH ?? 2), last_seen: iso(o.seenH ?? 1), edit_count: 0, ...o,
  };
  delete r.now; delete r.ageH; delete r.seenH;
  return r;
}

export function insertListing(world, o = {}) {
  const r = listingRow(o);
  const cols = Object.keys(r);
  world.run(`INSERT OR REPLACE INTO listings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => r[c] ?? null));
  return r;
}

/** پاک‌کردن کد خروج که runner/runJob هنگام خطا می‌گذارند (تا پردازش تست خراب نشود) */
export function resetExit() { process.exitCode = 0; }
