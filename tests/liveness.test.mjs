import { makeWorld, insertListing, detail } from './helpers/world.mjs';
import { quiet } from './helpers/quiet.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeD1Client } from '../shared/d1-client.mjs';
import { runLiveness, classifyDetail } from '../jobs/liveness.mjs';

let w;
let d1;
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
beforeEach(() => { w = makeWorld(); d1 = makeD1Client(); });
afterEach(() => w.restore());

const add = (token, o = {}) => insertListing(w, { token, now: NOW, ...o });
const run = (o = {}) => quiet(() => runLiveness({ d1, now: NOW, log: () => {}, env: { ...process.env, ...(o.env ?? {}) } })).then((r) => r.result);
const state = (t) => w.one('SELECT * FROM listing_state WHERE token = ?', t);

test('classifyDetail: فعال، فروخته، منقضی، حذف، مسدود، بسته', () => {
  assert.deepEqual(classifyDetail({ status_en: 'published' }, NOW), { active: true, reason: null });
  assert.deepEqual(classifyDetail({}, NOW), { active: true, reason: null });
  assert.deepEqual(classifyDetail({ status_en: 'sold' }, NOW), { active: false, reason: 'sold' });
  assert.deepEqual(classifyDetail({ status_en: 'EXPIRED' }, NOW), { active: false, reason: 'expired' });
  assert.deepEqual(classifyDetail({ status_en: 'deleted' }, NOW), { active: false, reason: 'deleted' });
  assert.deepEqual(classifyDetail({ status_en: 'blocked' }, NOW), { active: false, reason: 'blocked' });
  assert.deepEqual(classifyDetail({ status_en: 'archived' }, NOW), { active: false, reason: 'closed' });
  assert.deepEqual(classifyDetail({ status_en: 'منقضی شده' }, NOW), { active: false, reason: 'expired' });
  assert.deepEqual(classifyDetail({ status_en: 'published', unavailable_after: '2026-10-01T00:00:00Z' }, NOW), { active: false, reason: 'expired' });
  assert.deepEqual(classifyDetail({ status_en: 'published', unavailable_after: '2026-12-01T00:00:00Z' }, NOW), { active: true, reason: null });
  assert.deepEqual(classifyDetail({ unavailable_after: 'تاریخ خراب' }, NOW), { active: true, reason: null });
});

test('فعال، فروخته‌شده و حذف‌شده (۴۰۴) در listing_state ثبت می‌شوند و قیمت تازه می‌آید', async () => {
  add('L1'); add('L2'); add('L3', { price: 7_000_000 });
  w.source.listings.set('L1', { price: 17_000_000 });
  w.source.listings.set('L2', { status_en: 'sold' });
  const sum = await run(); // L3 در منبع نیست → ۴۰۴
  assert.deepEqual([sum.examined, sum.active, sum.closed, sum.soft, sum.written], [3, 1, 2, 0, 3]);
  assert.deepEqual(state('L1'), { token: 'L1', is_active: 1, checked_at: NOW, closed_reason: null, last_price: 17_000_000 });
  assert.deepEqual([state('L2').is_active, state('L2').closed_reason], [0, 'sold']);
  assert.deepEqual([state('L3').is_active, state('L3').closed_reason, state('L3').last_price], [0, 'deleted', 7_000_000]);
});

test('بازبینی دوباره فقط بعد از ۹۰ دقیقه؛ آگهی‌های قدیمی‌تر از ۷۲ ساعت بررسی نمی‌شوند', async () => {
  add('L1'); add('old', { ageH: 100, seenH: 90 });
  w.source.listings.set('L1', {}); w.source.listings.set('old', {});
  assert.equal((await run()).examined, 1);
  assert.equal(state('old'), null);
  const fetched = w.fetches.length;
  assert.equal((await run()).examined, 0);
  assert.equal(w.fetches.length, fetched + 1, 'فقط خود SELECT');
  const later = await quiet(() => runLiveness({ d1, now: NOW + 2 * 3_600_000, log: () => {} }));
  assert.equal(later.result.examined, 1);
  assert.equal(state('L1').checked_at, NOW + 2 * 3_600_000);
});

test('اولویت: بررسی‌نشده‌ها و آگهی‌های تطبیق‌خورده اول؛ سقف LIVENESS_MAX', async () => {
  add('plain', { ageH: 1 }); add('matched', { ageH: 5 }); add('checked', { ageH: 3 });
  for (const t of ['plain', 'matched', 'checked']) w.source.listings.set(t, {});
  w.run("INSERT INTO listing_features (token, model_id, match_method) VALUES ('matched', 'm', 'auto')");
  w.run("INSERT INTO listing_state (token, is_active, checked_at) VALUES ('checked', 1, ?)", NOW - 5 * 3_600_000);
  const order = [];
  w.route(/\/detail\//, (u) => { order.push(decodeURIComponent(u.split('/').pop())); return new Response(JSON.stringify(detail({ token: 'x' })), { status: 200 }); });
  const sum = await run({ env: { LIVENESS_MAX: '2' } });
  assert.equal(sum.examined, 2);
  assert.deepEqual(order, ['matched', 'plain'], 'ابتدا بدون state، سپس دارای مدل');
});

test('خطای نرم (کپچا): ۵ خطای پشت‌سرهم → توقف، بدون نوشتن؛ کد خروج ۰ می‌ماند', async () => {
  for (let i = 0; i < 8; i++) { add(`E${i}`); w.source.detailStatus.set(`E${i}`, 'html'); }
  process.exitCode = 0;
  const r = await quiet(() => runLiveness({ d1, now: NOW, log: () => {}, env: process.env }));
  assert.equal(r.result.soft, 5);
  assert.equal(r.result.examined, 0);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listing_state').c, 0);
  assert.match(r.errs.join('\n'), /۵ خطای پشت‌سرهم از منبع/);
  assert.equal(process.exitCode ?? 0, 0);
});

test('خطای نرم پراکنده: آگهی خراب رد می‌شود و بقیه ثبت می‌شوند', async () => {
  add('ok1'); add('bad'); add('ok2');
  w.source.listings.set('ok1', {}); w.source.listings.set('ok2', {});
  w.source.detailStatus.set('bad', 'html');
  const sum = await run();
  assert.deepEqual([sum.examined, sum.soft], [2, 1]);
  assert.equal(state('bad'), null);
});

test('پاسخ بدون محتوا فعال حساب نمی‌شود (خطای نرم)', async () => {
  add('blank');
  w.source.listings.set('blank', { __raw: {} });
  const sum = await run();
  assert.deepEqual([sum.examined, sum.soft], [0, 1]);
  assert.equal(state('blank'), null);
});

test('اگر تقریباً همه ۴۰۴ شوند، آدرس جزئیات مشکوک است: خطا و بدون نوشتن', async () => {
  for (let i = 0; i < 12; i++) add(`G${i}`); // هیچ‌کدام در منبع نیست
  await assert.rejects(quiet(() => runLiveness({ d1, now: NOW, log: () => {}, env: process.env })), /SOURCE_DETAIL_URL_BASE را چک کن/);
  assert.equal(w.one('SELECT COUNT(*) AS c FROM listing_state').c, 0);
});

test('اگر قیمت صفحه خالی باشد، قیمت قبلی آگهی نگه داشته می‌شود', async () => {
  add('np', { price: 9_000_000 });
  const raw = detail({ token: 'np', price: 0 });
  w.source.listings.set('np', { __raw: raw });
  await run();
  assert.equal(state('np').last_price, 9_000_000);
});
