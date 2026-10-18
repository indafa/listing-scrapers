import { detail } from './helpers/world.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetails } from '../categories/mobile-tablet/lib/parse-details.mjs';
import { checkStatus } from '../categories/mobile-tablet/lib/check-status.mjs';
import { DB_COLUMNS, BRANCHES, CONFIG } from '../categories/mobile-tablet/run.mjs';

const info = (o = {}) => ({ token: 'A1', title: 'عنوان جست‌وجو', district_persian: 'محله‌ی جست‌وجو', category: 'mobile-phones', ...o });

test('موبایل: فیلدهای اصلی از ویجت‌ها و webengage درمی‌آیند', () => {
  const p = parseDetails(detail({ token: 'A1', battery: '۹۱ درصد' }), info());
  assert.equal(p.token, 'A1');
  assert.equal(p.category, 'mobile-phones');
  assert.equal(p.title, 'اپل iPhone 13 ۱۲۸ گیگابایت');
  assert.equal(p.price, 18_500_000);
  assert.equal(p.internal_storage, 128);
  assert.equal(p.ram, 4);
  assert.equal(p.color, 'مشکی');
  assert.equal(p.device_condition, 'کارکرده');
  assert.equal(p.brand_model, 'Apple iPhone 13');
  assert.equal(p.battery_health, '۹۱ درصد');
  assert.equal(p.neighborhood, 'چهارباغ');
  assert.equal(p.city, 'اصفهان');
  assert.equal(p.seller_type, 'شخصی');
  assert.equal(p.link, 'https://source.test/v/A1');
  assert.equal(p.image_count, 5);
  assert.equal(p.description, 'سالم و تمیز، بدون خط و خش');
  assert.match(p.specs_text, /^price:18500000 \| status:کارکرده \| storage:128 \| ram:4 \| color:مشکی \| condition:کارکرده$/);
  // فیلدهای ویژه‌ی تبلت برای موبایل خالی می‌مانند
  assert.deepEqual([p.manufacturer, p.screen_size, p.os, p.connection_type], [null, null, null, null]);
  assert.deepEqual(JSON.parse(p.all_specs_json)['سلامت باتری'], '۹۱ درصد');
});

test('تبلت: ۱ ترابایت به عدد ۱ پارس می‌شود (تبدیل به ۱۰۲۴ در enrich) و فیلدهای تبلت پر می‌شوند', () => {
  const raw = detail({ token: 'T1', tablet: true, storage: '۱ ترابایت' });
  raw.sections[0].widgets.push(
    { widget_type: 'UNEXPANDABLE_ROW', data: { title: 'سازنده', value: 'اپل' } },
    { widget_type: 'UNEXPANDABLE_ROW', data: { title: 'سیستم عامل', value: 'iPadOS' } },
  );
  const p = parseDetails(raw, info({ token: 'T1', category: 'tablet' }));
  assert.equal(p.category, 'tablet');
  assert.equal(p.internal_storage, 1);
  assert.equal(p.manufacturer, 'اپل');
  assert.equal(p.os, 'iPadOS');
});

test('قیمت: عدد webengage اولویت دارد؛ وگرنه از متن؛ قیمت زیر ۱۰ هزار علامت می‌خورد', () => {
  const noWe = detail({ token: 'P1', price: 25_000_000 });
  delete noWe.webengage.price;
  noWe.sections[0].widgets.find((w) => w.data?.title === 'قیمت').data.value = '۲۵٬۰۰۰٬۰۰۰ تومان';
  assert.equal(parseDetails(noWe, info({ token: 'P1' })).price, 25_000_000);

  const low = parseDetails(detail({ token: 'P2', price: 5000 }), info({ token: 'P2' }));
  assert.match(low.price_note, /قیمت نامعتبر/);

  const negotiable = parseDetails(detail({ token: 'P3', price: 0 }), info({ token: 'P3' }));
  assert.equal(negotiable.price, null);
});

test('فروشگاه/شخصی از business_type؛ محله‌ی پشتیبان از نتیجه‌ی جست‌وجو وقتی ویجت محله نیست', () => {
  const shop = parseDetails(detail({ token: 'S1', business: 'shop' }), info({ token: 'S1' }));
  assert.equal(shop.seller_type, 'فروشگاه/آژانس');
  const raw = detail({ token: 'S2' });
  raw.sections[0].widgets = raw.sections[0].widgets.filter((w) => w.widget_type !== 'EXPANDABLE_SECTION');
  assert.equal(parseDetails(raw, info({ token: 'S2' })).neighborhood, 'محله‌ی جست‌وجو');
});

test('پاسخ تهی یا ناقص خطا نمی‌دهد (token می‌ماند، بقیه null/خالی)', () => {
  const p = parseDetails({}, info({ token: 'E1' }));
  assert.equal(p.token, 'E1');
  assert.equal(p.price, null);
  assert.equal(p.title, 'عنوان جست‌وجو');
  assert.equal(p.description, '');
});

test('checkStatus: new → edited (تغییر مشخصات) → seen (بدون تغییر)', () => {
  const p = parseDetails(detail({ token: 'A1' }), info());
  const first = checkStatus(p, null);
  assert.equal(first.status, 'new');
  assert.equal(first.edit_count, 0);
  assert.equal(first.is_broadcasted, 0);

  const stored = { ...first, is_broadcasted: 1 };
  const same = checkStatus(parseDetails(detail({ token: 'A1' }), info()), stored);
  assert.equal(same.status, 'seen');
  assert.equal(same.is_broadcasted, 1);
  assert.equal(same.first_seen, stored.first_seen);

  const changed = checkStatus(parseDetails(detail({ token: 'A1', price: 17_000_000 }), info()), stored);
  assert.equal(changed.status, 'edited');
  assert.equal(changed.edit_count, 1);
  assert.equal(changed.is_broadcasted, 0);
  assert.equal(changed.first_seen, stored.first_seen);
});

test('پیکربندی دسته: شاخه‌ها، ستون‌ها و بدون امتیازدهی', () => {
  assert.deepEqual(BRANCHES.map((b) => [b.searchSlug, b.storeAs, b.scored]), [['mobile-phones', 'mobile-phones', false], ['tablet', 'tablet', false]]);
  assert.equal(CONFIG.categoryKey, 'mobile-tablet');
  assert.equal(new Set(DB_COLUMNS).size, DB_COLUMNS.length, 'ستون تکراری');
  // هر ستونی که parseDetails/checkStatus می‌سازد و در DB_COLUMNS است باید در خروجی باشد
  const out = checkStatus(parseDetails(detail({ token: 'A1' }), info()), null);
  for (const c of DB_COLUMNS) if (!['delivered_to', 'broadcast_attempts'].includes(c)) assert.ok(c in out, `ستون ${c} در خروجی پارسر نیست`);
});
