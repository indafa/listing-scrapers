// دسته: موبایل و تبلت — بدون امتیازدهی
import { pathToFileURL } from 'node:url';
import { runScraper }   from '../../shared/runner.mjs';
import { parseDetails } from './lib/parse-details.mjs';
import { checkStatus }  from './lib/check-status.mjs';

export const DB_COLUMNS = ['token','title','category','link','status','device_condition','brand_model','internal_storage','ram','color','price','price_note','sim_count','originality','manufacturer','screen_size','os','connection_type','camera_condition','screen_condition','body_condition','box_status','battery_health','ownership_transfer','adapter','charging_cable','location','neighborhood','district_slug','city','latitude','longitude','seller_type','business_type','image_count','description','all_specs_json','is_broadcasted','broadcast_attempts','delivered_to','specs_text','first_seen','last_seen','edit_count'];

export const BRANCHES = [
  { searchSlug: 'mobile-phones', storeAs: 'mobile-phones', scored: false },
  { searchSlug: 'tablet',        storeAs: 'tablet',        scored: false },
];

export const CONFIG = {
  categoryKey: 'mobile-tablet',
  branches: BRANCHES,
  dbColumns: DB_COLUMNS,
  statsColumns: [],
  // ستون‌هایی که در نسخه‌ی قبلی دیتابیس نبودند: اسکرپر اگر ندیدشان، خودش اضافه‌شان می‌کند (نیاز به کار دستی نیست).
  schemaAdditions: { delivered_to: 'TEXT' },
  parseDetails, checkStatus,
  buildStatsMap: null, calculateScore: null,
};

export function main() {
  return runScraper(CONFIG).catch((e) => { console.error('💥 خطای کلی:', e?.message ?? e); process.exit(1); });
}

// فقط وقتی مستقیم اجرا شود (node categories/mobile-tablet/run.mjs)؛ در تست‌ها import بدون اجرا کار می‌کند.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
