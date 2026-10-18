// کار liveness (هر ساعت): آگهی‌های ۷۲ ساعت اخیر را (حداکثر ~۱۵۰ درخواست) دوباره از منبع می‌گیرد و
// در listing_state ثبت می‌کند که هنوز فعال‌اند یا بسته شده‌اند. Worker فقط لینک آگهی‌های «فعال و
// بررسی‌شده در ۶ ساعت اخیر» را به مشتری می‌دهد.
//
// خطای منبع (کپچا، ۴۲۹، قطع شبکه) نرم است: کار متوقف می‌شود، کد خروج ۰ می‌ماند و آگهی‌ها دست‌نخورده می‌مانند.
import { fetchDetail } from '../shared/source-api.mjs';
import { parseDetails } from '../categories/mobile-tablet/lib/parse-details.mjs';
import { isoAgo, upsertMany, runJob, isMain, sleep, HOUR } from '../shared/job-utils.mjs';

const WINDOW_HOURS = 72;
const CLOSED_RE = /(sold|expired|deleted|removed|closed|archived|inactive|unavailable|blocked|banned|rejected|suspended|فروخته|منقضی|حذف|بسته)/i;

/** از خروجی parseDetails تشخیص می‌دهد آگهی فعال است یا نه. (مقدارهای status_en واقعی منبع راستی‌آزمایی نشده؛ لاگ را ببین.) */
export function classifyDetail(parsed, nowMs = Date.now()) {
  if (parsed?.unavailable_after) {
    const t = Date.parse(parsed.unavailable_after);
    if (Number.isFinite(t) && t < nowMs) return { active: false, reason: 'expired' };
  }
  const st = String(parsed?.status_en ?? '').trim();
  if (st && CLOSED_RE.test(st)) {
    if (/sold|فروخته/i.test(st)) return { active: false, reason: 'sold' };
    if (/expired|منقضی/i.test(st)) return { active: false, reason: 'expired' };
    if (/deleted|removed|حذف/i.test(st)) return { active: false, reason: 'deleted' };
    if (/blocked|banned|rejected|suspended/i.test(st)) return { active: false, reason: 'blocked' };
    return { active: false, reason: 'closed' };
  }
  return { active: true, reason: null };
}

const SELECT_SQL = `
SELECT l.token, l.title, l.category, l.neighborhood, l.price
FROM listings l
LEFT JOIN listing_state s ON s.token = l.token
LEFT JOIN listing_features f ON f.token = l.token
WHERE l.first_seen >= ? AND (s.token IS NULL OR s.checked_at IS NULL OR s.checked_at < ?)
ORDER BY (s.token IS NULL) DESC, (f.model_id IS NOT NULL) DESC, COALESCE(s.checked_at, 0) ASC, l.first_seen DESC
LIMIT ?`;

export async function runLiveness({ d1, now = Date.now(), log = console.log, env = process.env } = {}) {
  const max = Number(env.LIVENESS_MAX || 150);
  const minRecheckMin = Number(env.LIVENESS_MIN_RECHECK_MINUTES || 90);
  const sum = { examined: 0, active: 0, closed: 0, soft: 0, written: 0 };
  const statusSeen = new Map();

  const rows = await d1.query(SELECT_SQL, [isoAgo(now, WINDOW_HOURS), now - minRecheckMin * 60_000, max]);
  const results = [];
  let consecutiveFails = 0;
  let notFound = 0;
  let stoppedEarly = null;

  for (const r of rows) {
    let state;
    try {
      const raw = await fetchDetail(r.token);
      const parsed = parseDetails(raw, { token: r.token, title: r.title, district_persian: r.neighborhood, category: r.category });
      if (!raw?.sections?.length && !raw?.webengage) throw Object.assign(new Error('پاسخ بدون محتوا'), { empty: true });
      const verdict = classifyDetail(parsed, now);
      const st = String(parsed.status_en ?? '(خالی)');
      statusSeen.set(st, (statusSeen.get(st) ?? 0) + 1);
      state = { active: verdict.active, reason: verdict.reason, price: parsed.price ?? r.price ?? null };
      consecutiveFails = 0;
    } catch (e) {
      if (e?.status === 404 || e?.status === 410) {
        notFound++;
        state = { active: false, reason: 'deleted', price: r.price ?? null };
        consecutiveFails = 0;
      } else {
        sum.soft++;
        consecutiveFails++;
        if (consecutiveFails >= 5) {
          stoppedEarly = String(e?.message ?? e).slice(0, 140);
          break;
        }
        continue;
      }
    }
    sum.examined++;
    results.push({
      token: r.token, is_active: state.active ? 1 : 0, checked_at: now,
      closed_reason: state.active ? null : state.reason, last_price: state.price,
    });
    if (Number(env.REQUEST_SPACING_MS ?? 1200) > 0) await sleep(Number(env.REQUEST_SPACING_MS ?? 1200));
  }

  // اگر تقریباً همه‌ی بررسی‌ها ۴۰۴ شدند، احتمالاً آدرس جزئیات اشتباه است نه اینکه همه‌ی آگهی‌ها حذف شده باشند
  if (sum.examined >= 10 && notFound / sum.examined >= 0.95) {
    throw new Error('تقریباً همه‌ی بررسی‌ها ۴۰۴ شدند؛ مقدار SOURCE_DETAIL_URL_BASE را چک کن. چیزی در listing_state نوشته نشد.');
  }
  if (stoppedEarly) {
    console.error(`⚠️  ۵ خطای پشت‌سرهم از منبع؛ بررسی تا اینجا متوقف شد (نتیجه‌ی بقیه‌ی آگهی‌ها دست‌نخورده می‌ماند): ${stoppedEarly}`);
  }

  const w = await upsertMany(d1, {
    table: 'listing_state', columns: ['token', 'is_active', 'checked_at', 'closed_reason', 'last_price'],
    rows: results, conflict: 'token',
  });
  sum.written = w.written;
  sum.active = results.filter((x) => x.is_active).length;
  sum.closed = results.length - sum.active;

  const seen = [...statusSeen.entries()].map(([k, v]) => `${k}×${v}`).join('، ') || '-';
  log(
    `✅ liveness — بررسی‌شده ${sum.examined} | فعال ${sum.active} | بسته ${sum.closed} | خطای نرم ${sum.soft} | نوشته‌شده ${sum.written} | status_en: ${seen}`
  );
  return sum;
}

if (isMain(import.meta.url)) {
  await runJob('liveness', (ctx) => runLiveness(ctx), { extraEnv: ['SOURCE_DETAIL_URL_BASE'] });
}
