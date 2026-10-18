// موتور مشترک اسکرپر — جمع‌آوری آگهی‌های عمومی از منبع و ذخیره در D1.
//
// جریان کار هر شاخه:
//   ۱) توکن‌های صفحه‌ی اول منبع را بگیر
//   ۲) رکوردهای موجود همین توکن‌ها را از D1 بخوان (برای تشخیص جدید/ویرایش‌شده)
//   ۳) آمار دسته را بخوان (فقط ستون‌های لازم — نه SELECT *)
//   ۴) جزئیات هر آگهی را بگیر، پارس کن، وضعیت بده، امتیاز بده
//   ۵) تغییرکرده‌ها را در D1 ذخیره کن (آگهی‌های بی‌تغییر فقط ساعتی یک‌بار)
//   ۶) آن‌هایی که هنوز پخش نشده‌اند را فقط به گیرنده‌هایی که هنوز نگرفته‌اند push کن
//   ۷) نتیجه‌ی تحویل هر گیرنده را ثبت کن (delivered_to) — وگرنه اجرای بعدی دوباره تلاش می‌کند
//
// چند قاعده‌ی مهم که این نسخه اضافه کرد:
//   • آگهی فقط وقتی ارسال می‌شود که ذخیره‌اش در D1 موفق بوده. (اگر ذخیره شکست بخورد و
//     ارسال بشود، اجرای بعدی همان آگهی را «جدید» می‌بیند و دوباره می‌فرستد → پیام تکراری.)
//   • اگر یک گیرنده خراب باشد، اجرای بعدی فقط به خودِ او دوباره می‌فرستد، نه به بقیه.
//   • ساختار جدول قبل از شروع چک می‌شود؛ ستون‌های تازه خودکار اضافه می‌شوند.
//   • اگر کل اجرا به‌خاطر مشکل زیرساخت بی‌نتیجه بماند، اجرا «قرمز» می‌شود تا گیت‌هاب ایمیل بدهد.

import fs from 'node:fs/promises';
import { makeD1Client, buildUpsertSQL } from './d1-client.mjs';
import { searchTokens, fetchDetail } from './source-api.mjs';

const REQUEST_SPACING_MS = Number(process.env.REQUEST_SPACING_MS || 1200);
// ۲۰۰۰ ردیف برای آمار محله‌ها کافی است و مصرف روزانه‌ی D1 را زیر سقف پلن رایگان نگه می‌دارد.
// اگر بعداً حجم داده زیاد شد و آمار دقیق‌تر خواستی، این را با متغیر STATS_LIMIT بالا ببر.
const STATS_LIMIT = Number(process.env.STATS_LIMIT || 2000);
const MAX_BROADCAST_ATTEMPTS = 3;

// آگهی‌ای که هیچ تغییری نکرده و قبلاً تحویل شده، تا این‌قدر دقیقه دوباره در D1 نوشته نمی‌شود.
// چرا: پلن رایگان D1 روزی فقط ۱۰۰ هزار «ردیف نوشتن» می‌دهد و هر نوشتن روی جدول و
// ایندکس‌ها چند ردیف حساب می‌شود. بدون این، هر ۱۰ دقیقه همه‌ی آگهی‌های صفحه‌ی اول
// دوباره نوشته می‌شدند و سقف روزانه تقریباً پر می‌شد. برای تغییرها هیچ تأخیری نیست.
// مقدار ۰ یعنی مثل قدیم همیشه بنویس. (نکته: رشته‌ی «0» در جاوااسکریپت truthy است، پس ۰ واقعاً ۰ می‌ماند.)
const LAST_SEEN_REFRESH_MINUTES = Number(process.env.LAST_SEEN_REFRESH_MINUTES || 60);

const PUSH_TIMEOUT_MS = Number(process.env.PUSH_TIMEOUT_MS || 30000);
const PUSH_ATTEMPTS = 3; // شامل تلاش اول
const PUSH_RETRY_BASE_MS = Number(process.env.PUSH_RETRY_BASE_MS || 2000);
const HEARTBEAT_TIMEOUT_MS = 8000;

// ستون‌هایی که موقع UPSERT نباید از رکورد جدید بازنویسی شوند.
const PRESERVE = ['first_seen'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadRecipients(path) {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`⚠️  فایل recipients خوانده نشد (${path}): ${e.message} — هیچ گیرنده‌ای فعال نیست.`);
    return [];
  }
}

// delivered_to در D1 به‌شکل رشته‌ی JSON ذخیره می‌شود: ["re-demo","re-ahmadi"]
function parseIdList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * ساختار جدول listings را با ستون‌هایی که این کد می‌نویسد مقایسه می‌کند.
 * چرا لازم است: اگر ستونی در دیتابیس نباشد، هر ذخیره خطا می‌دهد و (در نسخه‌های قبل)
 * ارسال ادامه پیدا می‌کرد؛ نتیجه پیام تکراریِ بی‌پایان بود.
 * ستون‌های «تازه» که خودمان تعریف کرده‌ایم (additions) خودکار اضافه می‌شوند؛
 * هر ستون ناشناخته‌ی دیگر اجرا را با پیام روشن متوقف می‌کند.
 */
async function ensureSchema(d1, dbColumns, additions = {}) {
  let info;
  try {
    info = await d1.query('PRAGMA table_info(listings)');
  } catch (e) {
    // خود این چک نباید سیستم را از کار بیندازد؛ اگر مشکل واقعی باشد، مراحل بعد هم خطا می‌دهند
    console.error(`⚠️  بررسی ساختار جدول انجام نشد (${e.message}) — ادامه می‌دهم.`);
    return;
  }
  if (!info.length) {
    throw new Error(
      'جدول listings در این دیتابیس وجود ندارد — ساخت پایگاه داده را طبق کتابچه (بخش «ساخت جدول‌ها») انجام بده یا مقدار CF_D1_DATABASE_ID را در Secrets چک کن.'
    );
  }
  const have = new Set(info.map((r) => r.name));
  const unknown = [];
  for (const col of dbColumns) {
    if (have.has(col)) continue;
    const type = additions[col];
    if (!type) {
      unknown.push(col);
      continue;
    }
    await d1.query(`ALTER TABLE listings ADD COLUMN ${col} ${type}`);
    console.log(`🛠  ستون تازه‌ی «${col}» به جدول listings اضافه شد.`);
  }
  if (unknown.length) {
    throw new Error(
      `این ستون‌ها در دیتابیس نیستند: ${unknown.join(', ')} — فایل ساخت جدول‌ها (schema.sql) را دوباره روی همین دیتابیس اجرا کن یا ستون‌ها را دستی اضافه کن.`
    );
  }
}

/**
 * یک آگهی را به یک گیرنده می‌فرستد.
 * خروجی: 'ok' (رسید) | 'retry' (مشکل موقت، دفعه‌ی بعد دوباره) | 'fatal' (پیکربندی غلط)
 */
async function pushToRecipient(recipient, listing, secretsMap) {
  const secret = secretsMap[recipient.id];
  if (!secret) {
    console.error(`❌ کلید INGEST_SECRETS_JSON برای «${recipient.id}» وجود ندارد — این گیرنده رد شد.`);
    return 'fatal';
  }
  if (!recipient.worker_url) {
    console.error(`❌ ${recipient.id}: worker_url در فایل recipients نیست — این گیرنده رد شد.`);
    return 'fatal';
  }
  let res;
  try {
    res = await fetch(recipient.worker_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': secret },
      body: JSON.stringify({ listing }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (e) {
    console.error(`⚠️  push به ${recipient.id} با خطای شبکه: ${e.message}`);
    return 'retry';
  }
  if (res.ok) return 'ok';
  const bodyText = await res.text().catch(() => '');
  if (res.status === 403) {
    console.error(`❌ ${recipient.id}: کلید اشتباه است (403). رمز آن گیرنده را با INGEST_SECRETS_JSON مقایسه کن.`);
    return 'fatal';
  }
  if (res.status === 404) {
    // (عمداً آدرس را چاپ نمی‌کنیم: اگر ریپو Public باشد، لاگ‌ها برای همه قابل‌خواندن است)
    console.error(`❌ ${recipient.id}: آدرس گیرنده پیدا نشد (404). worker_url در فایل recipients باید دقیقاً آدرس Worker + /ingest باشد.`);
    return 'fatal';
  }
  if (res.status === 500 && /misconfigured/i.test(bodyText.slice(0, 40))) {
    // گیرنده دیپلوی شده ولی رمزها/تنظیماتش ناقص است؛ تکرار کمکی نمی‌کند و فقط به بقیه‌ی گیرنده‌ها پیام تکراری می‌رساند
    console.error(`❌ ${recipient.id}: پیکربندی گیرنده ناقص است — ${bodyText.slice(0, 200)} | /health همان Worker را باز کن.`);
    return 'fatal';
  }
  if (res.status >= 500) {
    console.error(`⚠️  ${recipient.id}: خطای سرور ${res.status} — دوباره تلاش می‌شود.`);
    return 'retry';
  }
  console.error(`⚠️  ${recipient.id}: پاسخ ${res.status} ${bodyText.slice(0, 120)}`);
  return 'retry';
}

/**
 * تلاش مجدد داخل همین اجرا (برای لرزش‌های لحظه‌ای)، با «فیوز» برای گیرنده‌ی خراب.
 * failStreaks: برای هر گیرنده، چند آگهیِ پشت‌سرهم در همین اجرا به او نرسیده.
 *   • بار اول ۳ تلاش با فاصله؛ بعد از یک شکستِ کامل، برای آگهی‌های بعدی فقط ۱ تلاش؛
 *   • بعد از ۲ شکست پشت‌سرهم، تا پایان همین اجرا اصلاً صدایش نمی‌زنیم.
 * چرا: گیرنده‌ای که «جواب نمی‌دهد» (نه اینکه سریع خطا بدهد) هر تلاش را تا ۳۰ ثانیه معطل می‌کند؛
 * با ۹۶ آگهی، بدون فیوز یک گیرنده‌ی خراب اجرا را تا سقف زمانی گیت‌هاب نگه می‌داشت و
 * ارسال به گیرنده‌ی سالم هم عقب می‌افتاد. آگهی‌های ردشده برای اجرای بعد می‌مانند (و بعد از ۳ اجرا رها می‌شوند).
 */
const SKIP_AFTER_FAILED_LISTINGS = 2;
async function pushWithRetry(recipient, listing, secretsMap, failStreaks) {
  const streak = failStreaks.get(recipient.id) || 0;
  if (streak >= SKIP_AFTER_FAILED_LISTINGS) return 'retry';
  const attempts = streak >= 1 ? 1 : PUSH_ATTEMPTS;
  let outcome = 'retry';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    outcome = await pushToRecipient(recipient, listing, secretsMap);
    if (outcome !== 'retry') break;
    if (attempt < attempts) await sleep(attempt * PUSH_RETRY_BASE_MS);
  }
  if (outcome === 'retry') {
    failStreaks.set(recipient.id, streak + 1);
    if (streak + 1 === SKIP_AFTER_FAILED_LISTINGS) {
      console.error(`⏭  ${recipient.id}: ${SKIP_AFTER_FAILED_LISTINGS} آگهی پشت‌سرهم به او نرسید — تا پایان همین اجرا صدایش نمی‌زنم (آگهی‌ها برای اجرای بعد می‌مانند).`);
    }
  } else {
    failStreaks.set(recipient.id, 0);
  }
  return outcome;
}

// هر اجرا یک بار به هر گیرنده‌ی فعال «ضربان» می‌فرستد (اختیاری؛ خطایش هیچ‌وقت اجرا را خراب نمی‌کند).
async function sendHeartbeats(recipients, secretsMap) {
  await Promise.all(
    recipients.map(async (r) => {
      const secret = secretsMap[r.id];
      if (!secret || !r.worker_url) return;
      const url = r.worker_url.replace(/\/ingest\/?$/, '') + '/heartbeat';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'X-Ingest-Secret': secret },
          signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
        });
        if (res.status === 404) {
          console.log(`ℹ️  ${r.id}: این گیرنده هنوز /heartbeat ندارد (خطر ندارد).`);
        } else if (!res.ok) {
          console.error(`ℹ️  ${r.id}: heartbeat پاسخ ${res.status} داد.`);
        }
      } catch {
        /* ضربان فقط یک امکان جانبی است؛ هیچ‌وقت نباید اجرا را خراب کند */
      }
    })
  );
}

export async function runScraper(config) {
  const {
    categoryKey, // 'mobile-tablet'
    branches, // [{ searchSlug, storeAs, scored }]
    dbColumns,
    parseDetails,
    checkStatus,
    buildStatsMap,
    calculateScore,
    statsColumns,
    schemaAdditions = {}, // ستون‌هایی که اگر در دیتابیس قدیمی نبودند، خودکار اضافه می‌شوند
  } = config;

  const cityId = process.env.SOURCE_CITY_ID || '4';
  const recipientsPath = process.env.RECIPIENTS_PATH || './recipients/empty.json';
  const d1 = makeD1Client(process.env.CF_D1_DATABASE_ID);

  const recipients = (await loadRecipients(recipientsPath)).filter((r) => r.category === categoryKey && r.id);
  let secretsMap = {};
  try {
    secretsMap = JSON.parse(process.env.INGEST_SECRETS_JSON || '{}');
  } catch {
    console.error('❌ INGEST_SECRETS_JSON یک JSON معتبر نیست — هیچ ارسالی انجام نمی‌شود.');
  }

  console.log(`▶️  دسته: ${categoryKey} | شهر: ${cityId} | گیرنده‌ها: ${recipients.length}`);
  if (recipients.length === 0) {
    console.log('ℹ️  هیچ گیرنده‌ای ثبت نشده — فقط جمع‌آوری داده انجام می‌شود، ارسالی در کار نیست.');
  }

  await ensureSchema(d1, dbColumns, schemaAdditions);

  const summary = { total: 0, toSend: 0, sent: 0, retryLater: 0, notSaved: 0, writes: 0, skippedWrites: 0 };
  const branchOutcomes = { ok: 0, empty: 0, failed: 0 };
  const failStreaks = new Map();

  for (const branch of branches) {
    branchOutcomes[await processBranch(branch)]++;
  }

  await sendHeartbeats(recipients, secretsMap);

  console.log(
    `✅ پایان ${categoryKey} — پردازش‌شده ${summary.total} | نیازمند ارسال ${summary.toSend} | ارسال‌شده ${summary.sent} | موکول به بعد ${summary.retryLater}`
  );
  console.log(`💾 نوشتن در D1: ${summary.writes} ردیف | بدون نوشتن (بی‌تغییر و تازه): ${summary.skippedWrites}`);

  // اگر هیچ شاخه‌ای کار مفیدی نکرد (همه خطا دادند یا همه خالی بودند)، اجرا را «قرمز» کن.
  // اجرای سبز که هیچ کاری نکرده، بدترین حالت است: هیچ‌کس متوجه نمی‌شود.
  if (branches.length > 0 && branchOutcomes.ok === 0) {
    if (branchOutcomes.failed > 0) {
      console.error('💥 هیچ‌کدام از شاخه‌ها کامل نشد — مشکل زیرساخت است (منبع، D1 یا توکن‌ها). لاگ‌های بالا را بخوان.');
    } else {
      console.error(`💥 منبع برای هیچ‌کدام از شاخه‌ها آگهی برنگرداند — شماره‌ی شهر (SOURCE_CITY_ID=${cityId}) را چک کن یا مطمئن شو منبع جلوی درخواست‌ها را نگرفته.`);
    }
    process.exitCode = 1;
  }

  /** @returns {Promise<'ok'|'empty'|'failed'>} */
  async function processBranch(branch) {
    const label = branch.storeAs;

    // ── ۱) توکن‌ها ────────────────────────────────────────────────────────────
    let tokenInfos;
    try {
      tokenInfos = await searchTokens(branch.searchSlug, branch.storeAs, cityId);
    } catch (e) {
      console.error(`❌ جست‌وجوی ${label} شکست خورد: ${e.message}`);
      return 'failed';
    }
    if (!tokenInfos.length) {
      console.log(`ℹ️  ${label}: هیچ آگهی‌ای در نتایج جست‌وجو نبود.`);
      return 'empty';
    }

    // ── ۲) رکوردهای موجود (dedupe دقیق، بدون سقف) ─────────────────────────────
    let existingByToken;
    try {
      const rows = await d1.selectIn(
        'SELECT * FROM listings WHERE token IN ({{IN}})',
        tokenInfos.map((t) => t.token)
      );
      existingByToken = new Map(rows.map((r) => [r.token, r]));
    } catch (e) {
      console.error(`❌ خواندن رکوردهای موجود ${label} شکست خورد: ${e.message}`);
      return 'failed';
    }

    // ── ۳) آمار (فقط برای دسته‌های امتیازدار) ──────────────────────────────────
    let statsBundle = null;
    if (branch.scored) {
      try {
        const rows = await d1.query(
          `SELECT ${statsColumns.join(', ')} FROM listings WHERE category = ? ORDER BY last_seen DESC LIMIT ?`,
          [branch.storeAs, STATS_LIMIT]
        );
        statsBundle = buildStatsMap(rows);
        console.log(`📈 ${label}: آمار از ${rows.length} رکورد ساخته شد.`);
        if (rows.length === 0) {
          console.log(`ℹ️  ${label}: دیتابیس هنوز خالی است — چند اجرای اول همه امتیاز ۵ می‌گیرند. طبیعی است.`);
        }
      } catch (e) {
        console.error(`❌ خواندن آمار ${label} شکست خورد: ${e.message}`);
        return 'failed';
      }
    }

    // ── ۴) جزئیات + وضعیت + امتیاز ────────────────────────────────────────────
    const processed = [];
    let failCount = 0;
    for (const tokenInfo of tokenInfos) {
      try {
        const raw = await fetchDetail(tokenInfo.token);
        const parsed = parseDetails(raw, tokenInfo);
        if (!parsed || !parsed.token) continue;
        const prev = existingByToken.get(parsed.token) || null;
        const withStatus = checkStatus(parsed, prev);

        // آگهی وقتی «نیازمند ارسال» است که جدید/ویرایش‌شده باشد،
        // یا قبلاً نیازمند ارسال بوده ولی تحویل نشده (is_broadcasted هنوز صفر است).
        const isFresh = withStatus.status === 'new' || withStatus.status === 'edited';
        const previouslyUndelivered = !!prev && Number(prev.is_broadcasted) === 0;
        const attempts = isFresh ? 0 : Number(prev?.broadcast_attempts || 0);
        // بدون گیرنده هیچ آگهی‌ای «نیازمند ارسال» نیست؛ وگرنه is_broadcasted برای همیشه ۰ می‌ماند و
        // هر آگهی‌ی صفحه‌ی اول در هر اجرا دوباره در D1 نوشته می‌شد (چند برابر مصرف نوشتن روزانه).
        const needsBroadcast = recipients.length > 0 && (isFresh || previouslyUndelivered) && attempts < MAX_BROADCAST_ATTEMPTS;

        const record = branch.scored ? calculateScore(statsBundle, withStatus) : withStatus;
        record.is_broadcasted = needsBroadcast ? 0 : 1;
        record.broadcast_attempts = attempts;
        record._needsBroadcast = needsBroadcast;

        // گیرنده‌هایی که همین نسخه‌ی آگهی را قبلاً گرفته‌اند (فقط برای تلاش مجدد معنا دارد)
        const delivered = isFresh ? [] : parseIdList(prev?.delivered_to);
        record._delivered = delivered;
        record.delivered_to = JSON.stringify(delivered);

        // آگهی تحویل‌نشده‌ای که برای بار دوم تلاش می‌شود، در این اجرا «seen» دیده می‌شود؛
        // ولی پیام باید همچنان «جدید/ویرایش‌شده» بنویسد، نه اشتباهاً «ویرایش‌شده».
        if (!isFresh && previouslyUndelivered && (prev.status === 'new' || prev.status === 'edited')) {
          record.status = prev.status;
        }

        // بی‌تغییر + قبلاً تحویل‌شده + به‌تازگی دیده‌شده → لازم نیست دوباره در D1 نوشته شود
        const lastSeenMs = prev?.last_seen ? Date.parse(prev.last_seen) : NaN;
        const freshEnough =
          LAST_SEEN_REFRESH_MINUTES > 0 &&
          Number.isFinite(lastSeenMs) &&
          Date.now() - lastSeenMs < LAST_SEEN_REFRESH_MINUTES * 60000;
        record._skipWrite = !!(
          prev &&
          withStatus.status === 'seen' &&
          Number(prev.is_broadcasted) === 1 &&
          !needsBroadcast &&
          freshEnough
        );

        processed.push(record);
      } catch (e) {
        failCount++;
        console.error(`❌ جزئیات ${tokenInfo.token}: ${e.message}`);
      }
      await sleep(REQUEST_SPACING_MS);
    }
    if (failCount) console.error(`⚠️  ${label}: ${failCount} آگهی به‌خاطر خطا پردازش نشد.`);
    if (failCount > 0 && processed.length === 0) return 'failed'; // هیچ آگهی‌ای پردازش نشد (مثلاً منبع جلوی درخواست‌ها را گرفته)

    // ── ۵) ذخیره در D1 ────────────────────────────────────────────────────────
    const persisted = new Set();
    let attemptedWrites = 0;
    for (const rec of processed) {
      if (rec._skipWrite) {
        summary.skippedWrites++;
        continue;
      }
      attemptedWrites++;
      const { sql, params } = buildUpsertSQL('listings', rec, dbColumns, PRESERVE);
      try {
        await d1.query(sql, params);
        persisted.add(rec.token);
        summary.writes++;
      } catch (e) {
        console.error(`⚠️  ذخیره‌ی ${rec.token} شکست خورد: ${e.message}`);
      }
    }

    // ── ۶) ارسال ──────────────────────────────────────────────────────────────
    const needSend = processed.filter((r) => r._needsBroadcast);
    const toSend = needSend.filter((r) => persisted.has(r.token));
    const notSaved = needSend.length - toSend.length;
    summary.total += processed.length;
    summary.toSend += needSend.length;
    summary.notSaved += notSaved;
    console.log(`📊 ${label}: کل ${processed.length} | نیازمند ارسال ${needSend.length}`);
    if (notSaved) {
      console.error(`⚠️  ${label}: ${notSaved} آگهی چون در D1 ذخیره نشد این‌بار فرستاده نشد (اجرای بعدی دوباره تلاش می‌کند).`);
    }

    if (recipients.length && toSend.length) {
      for (const listing of toSend) {
        await deliver(listing);
      }
    }

    return attemptedWrites > 0 && persisted.size === 0 ? 'failed' : 'ok';
  }

  async function deliver(listing) {
    const delivered = new Set(listing._delivered);
    const pending = recipients.filter((r) => !delivered.has(r.id));

    const payload = { ...listing };
    delete payload._needsBroadcast;
    delete payload._delivered;
    delete payload._skipWrite;
    delete payload.delivered_to;

    const results = await Promise.all(
      pending.map(async (r) => ({ id: r.id, outcome: await pushWithRetry(r, payload, secretsMap, failStreaks) }))
    );
    for (const { id, outcome } of results) if (outcome === 'ok') delivered.add(id);
    const anyRetry = results.some((x) => x.outcome === 'retry');
    const attemptsBefore = Number(listing.broadcast_attempts || 0);

    // ── ۷) علامت‌گذاری تحویل ────────────────────────────────────────────────
    if (anyRetry) {
      const nextAttempts = attemptsBefore + 1;
      summary.retryLater++;
      if (nextAttempts >= MAX_BROADCAST_ATTEMPTS) {
        console.error(`⛔️ ${listing.token}: بعد از ${nextAttempts} اجرا برای بعضی گیرنده‌ها تحویل نشد — از صف خارج شد.`);
        await markBroadcast(listing.token, 1, nextAttempts, delivered);
      } else {
        await markBroadcast(listing.token, 0, nextAttempts, delivered);
      }
    } else {
      summary.sent++;
      await markBroadcast(listing.token, 1, attemptsBefore, delivered);
    }
  }

  async function markBroadcast(token, flag, attempts, deliveredSet) {
    try {
      await d1.query('UPDATE listings SET is_broadcasted = ?, broadcast_attempts = ?, delivered_to = ? WHERE token = ?', [
        flag,
        attempts,
        JSON.stringify([...deliveredSet]),
        token,
      ]);
    } catch (e) {
      console.error(`⚠️  به‌روزرسانی وضعیت پخش ${token} شکست خورد: ${e.message}`);
    }
  }
}
