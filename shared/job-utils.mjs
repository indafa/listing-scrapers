// ابزارهای مشترک کارهای jobs/*: تنظیمات، نوشتن دسته‌ای، اجرای امن و لاگ یک‌خطی.
// هیچ AI و هیچ داده‌ی مشتری در این ریپو نیست؛ فقط آگهی‌ها، قیمت‌ها و کاتالوگ.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { makeD1Client, makeScrubber } from './d1-client.mjs';

export const MAX_PARAMS = 90;
export const HOUR = 3_600_000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function chunk(arr, n = MAX_PARAMS) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');

/** زمان ISO به‌اندازه‌ی `hours` ساعت قبل از `now` (فرمت ستون‌های first_seen / last_seen) */
export const isoAgo = (now, hours) => new Date(now - hours * HOUR).toISOString();

export const sha1 = (s) => createHash('sha1').update(String(s)).digest('hex');

export function parseJsonArray(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** خواندن چند کلید از bot_settings؛ کلیدهای نبوده برنمی‌گردند. */
export async function getSettings(d1, keys) {
  const out = {};
  if (!keys.length) return out;
  const rows = await d1.selectIn('SELECT key, value FROM bot_settings WHERE key IN ({{IN}})', keys);
  for (const r of rows) out[r.key] = r.value;
  return out;
}

const norm = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

/**
 * INSERT چندردیفی با ON CONFLICT DO UPDATE (تا سقف پارامتر D1 دسته‌بندی می‌شود).
 * اگر یک دسته خطا بدهد، ردیف‌های همان دسته جدا جدا امتحان می‌شوند تا ردیف خراب بقیه را نبرد.
 * @returns {{ written: number, failed: number, errors: string[] }}
 */
export async function upsertMany(d1, { table, columns, rows, conflict, updateColumns, where = '' }) {
  const result = { written: 0, failed: 0, errors: [] };
  if (!rows.length) return result;
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const conflictCols = Array.isArray(conflict) ? conflict : [conflict];
  const updates = (updateColumns || columns.filter((c) => !conflictCols.includes(c)))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const tail = ` ON CONFLICT(${conflictCols.join(', ')}) DO UPDATE SET ${updates}${where ? ' WHERE ' + where : ''}`;
  const one = `(${placeholders(columns.length)})`;
  const run = async (part) => {
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${part.map(() => one).join(', ')}${tail}`;
    await d1.query(sql, part.flatMap((r) => columns.map((c) => norm(r[c]))));
  };
  for (const part of chunk(rows, perStmt)) {
    try {
      await run(part);
      result.written += part.length;
    } catch (e) {
      if (part.length === 1) {
        result.failed++;
        result.errors.push(String(e.message).slice(0, 160));
        continue;
      }
      for (const r of part) {
        try {
          await run([r]);
          result.written++;
        } catch (e2) {
          result.failed++;
          result.errors.push(String(e2.message).slice(0, 160));
        }
      }
    }
  }
  return result;
}

/** INSERT OR IGNORE چندردیفی (برای جدول‌هایی که فقط افزوده می‌شوند). */
export async function insertIgnoreMany(d1, { table, columns, rows }) {
  let written = 0;
  if (!rows.length) return written;
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const one = `(${placeholders(columns.length)})`;
  for (const part of chunk(rows, perStmt)) {
    const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES ${part.map(() => one).join(', ')}`;
    await d1.query(sql, part.flatMap((r) => columns.map((c) => norm(r[c]))));
    written += part.length;
  }
  return written;
}

export function requireEnv(names, env = process.env) {
  const missing = names.filter((n) => !String(env[n] ?? '').trim());
  if (missing.length) {
    throw new Error(`این متغیرها تنظیم نشده‌اند: ${missing.join('، ')} — در Settings ← Secrets and variables ← Actions وارد کن.`);
  }
}

export function fmtD1Stats(d1) {
  const s = d1.stats;
  return s ? `D1: ${s.requests} درخواست، ${s.rowsWritten} ردیف نوشته‌شده` : '';
}

/**
 * اجرای یک کار: ساخت کلاینت D1، اجرا، و خروج با کد ۱ فقط برای خطای واقعی (D1 یا پیکربندی).
 * خطای نرم (منبع/فید در دسترس نیست) را خود کار مدیریت می‌کند و کد خروج ۰ می‌ماند.
 * هیچ مقدار سکرتی در خروجی چاپ نمی‌شود.
 */
export async function runJob(name, fn, { extraEnv = [], env = process.env } = {}) {
  const scrub = makeScrubber([env.CF_API_TOKEN, env.CF_ACCOUNT_ID, env.CF_D1_DATABASE_ID]);
  try {
    requireEnv(['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_D1_DATABASE_ID', ...extraEnv], env);
    const d1 = makeD1Client(env.CF_D1_DATABASE_ID);
    const t0 = Date.now();
    const summary = await fn({ d1, now: Date.now(), env, log: console.log });
    console.log(`⏱  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} ثانیه | ${fmtD1Stats(d1)}`);
    return summary;
  } catch (e) {
    console.error(`❌ ${name}: ${scrub(e?.message ?? e)}`);
    process.exitCode = 1;
    return null;
  }
}

/** آیا این ماژول مستقیم با node اجرا شده است؟ */
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
