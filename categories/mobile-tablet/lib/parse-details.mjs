// پارس پاسخ جزئیات آگهی به ردیف listings. (نام شهر و لینک آگهی از SOURCE_CITY_NAME و SOURCE_LINK_BASE می‌آیند.)
import { sourceLink } from '../../../shared/source-api.mjs';

export function parseDetails(raw, tokenInfo) {
  const $input = { item: { json: raw } };
  const $ = (nodeName) => {
    if (nodeName === "Code: Extract Tokens") return { item: { json: tokenInfo } };
    throw new Error('parseDetails shim: unexpected node ref ' + nodeName);
  };
  const __result = (() => {
    const raw = $input.item.json;
    const tokenInfo = $("Code: Extract Tokens").item?.json || {};

    const token       = tokenInfo.token || null;
    const searchTitle = tokenInfo.title || null;
    const fallbackDistrict = tokenInfo.district_persian || null;
    const category    = tokenInfo.category || "mobile-phones";

    // اگر آیتم خالی بود رد بشه
    if (tokenInfo._empty) return [];

    // ── همه ویجت‌ها ──────────────────────────────────────────
    const all_widgets = [];
    if (Array.isArray(raw.sections)) {
      for (const section of raw.sections) {
        if (Array.isArray(section.widgets)) {
          all_widgets.push(...section.widgets);
        }
      }
    }
    const findWidget     = (type) => all_widgets.find(w => w.widget_type === type);
    const findAllWidgets = (type) => all_widgets.filter(w => w.widget_type === type);

    // ── ابزار تبدیل عدد فارسی ────────────────────────────────
    const toNumber = (text) => {
      if (text === null || text === undefined) return null;
      const normalized = String(text)
        .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0)
        .replace(/[^\d.]/g, "");
      const num = parseFloat(normalized);
      return isNaN(num) ? null : num;
    };

    // ── عنوان ─────────────────────────────────────────────────
    const titleWidget = findWidget("LEGEND_TITLE_ROW");
    const title = titleWidget?.data?.title || searchTitle;

    // ── محله — از EXPANDABLE_SECTION ──────────────────────────
    let neighborhood_persian = fallbackDistrict;
    const expandW = findWidget("EXPANDABLE_SECTION");
    if (expandW?.data?.title) {
      const m = expandW.data.title.match(/در [^،]+،\s*([^،\n]+)/);
      if (m) neighborhood_persian = m[1].trim();
    }

    // ── مختصات — FUZZY یا EXACT یا مستقیم ─────────────────────
    let latitude = null, longitude = null;
    const mapWidget = findWidget("MAP_ROW");
    if (mapWidget?.data?.location) {
      const loc = mapWidget.data.location;
      if (loc.type === "FUZZY" && loc.fuzzy_data?.point) {
        latitude  = loc.fuzzy_data.point.latitude  || null;
        longitude = loc.fuzzy_data.point.longitude || null;
      }
      else if (loc.exact_data?.point) {
        latitude  = loc.exact_data.point.latitude  || null;
        longitude = loc.exact_data.point.longitude || null;
      }
      else if (loc.latitude && loc.longitude) {
        latitude  = loc.latitude;
        longitude = loc.longitude;
      }
    }

    // ── ✅ همه UNEXPANDABLE_ROW سطح بالا → یه map (title -> value) ──
    const top_map = {};
    for (const w of findAllWidgets("UNEXPANDABLE_ROW")) {
      if (w?.data?.title && w?.data?.value !== undefined) {
        top_map[w.data.title] = w.data.value;
      }
    }

    // ── ✅ "سایر ویژگی‌ها و امکانات" — داخل modal_page یک SELECTOR_ROW ─
    // پارس‌کننده باید الگوی دوتایی DESCRIPTION_ROW + WRAPPER_ROW رو هم پشتیبانی کنه
    const modal_map = {};
    const selectorRow = all_widgets.find(
      w => w.widget_type === "SELECTOR_ROW" && w?.data?.action?.type === "LOAD_MODAL_PAGE"
    );
    const modalWidgets = selectorRow?.data?.action?.payload?.modal_page?.widget_list || [];

    let pendingLabel = null;
    for (const item of modalWidgets) {
      if (item.widget_type === "UNEXPANDABLE_ROW" && item?.data?.title) {
        modal_map[item.data.title] = item.data.value;
        pendingLabel = null;
      }
      else if (item.widget_type === "DESCRIPTION_ROW" && item?.data?.text) {
        // برچسب بدون مقدار (مثل "نوع اتصال") — منتظر WRAPPER_ROW بعدی می‌مونیم
        pendingLabel = item.data.text;
      }
      else if (item.widget_type === "WRAPPER_ROW" && pendingLabel) {
        const chip = item?.data?.chip_list?.chips?.[0]?.text || null;
        if (chip) modal_map[pendingLabel] = chip;
        pendingLabel = null;
      }
    }

    // ── all_specs_json — همه مشخصات (سطح بالا + مودال) ───────
    const all_specs = { ...top_map, ...modal_map };
    const all_specs_json = JSON.stringify(all_specs);

    // ── breadcrumb واقعی — از ویجت BREADCRUMB ──────────────────
    const breadcrumbWidget = findWidget("BREADCRUMB");
    const breadcrumb_parts = (breadcrumbWidget?.data?.parent_items || []).map(p => p.title);
    const current_page_title = breadcrumbWidget?.data?.current_page_title || null;
    const breadcrumb_full = breadcrumb_parts.length
      ? breadcrumb_parts.join(" › ") + (current_page_title ? " › " + current_page_title : "")
      : null;


    // ── webengage (منبع قابل اعتماد برای قیمت/برند/وضعیت) ────
    const we = raw.webengage || {};

    // ── دسته‌بندی سه‌سطحی (دقیق‌تر از category هاردکدشده) ──────────
    const cat_1 = we.cat_1 || raw.analytics?.cat1 || null;   // سطح اول: مثلا کالای دیجیتال
    const cat_2 = we.cat_2 || raw.analytics?.cat2 || null;   // سطح دوم: مثلا موبایل و تبلت
    const cat_3 = we.cat_3 || raw.analytics?.cat3 || category; // سطح سوم: tablet / mobile-phones

    // ── معادل فارسی تمیز دسته‌بندی نهایی ────────────────────────
    const category_persian = raw.seo?.web_info?.category_slug_persian || null;

    // ── وضعیت انگلیسی (مفید برای فیلتر/دیتابیس) ──────────────────
    const status_en = we.status || null;

    // ── تاریخ انقضای آگهی ─────────────────────────────────────────
    const unavailable_after = raw.seo?.unavailable_after || null;


    // ── قیمت — اولویت با webengage.price (عدد خام، بدون نیاز parse) ──
    const price = (typeof we.price === "number" && we.price > 0)
      ? we.price
      : toNumber(top_map["قیمت"]);

    let price_note = null;
    if (price !== null && price < 10000) {
      price_note = "قیمت نامعتبر - احتمالاً توافقی یا اشتباه parse شده";
    }

    // ── فیلدهای مشترک ─────────────────────────────────────────
    const status_persian   = top_map["وضعیت"] || null;
    const device_condition  = status_persian;  // ✅ وضعیت فیزیکی دستگاه (نو/در‌حد‌نو/کارکرده) - جدا از status که برای new/edited/seen استفاده می‌شه
    const internal_storage = toNumber(top_map["حافظهٔ داخلی"]);
    const ram              = toNumber(top_map["مقدار رم"]);
    const color             = top_map["رنگ"] || null;

    // ── فیلدهای اختصاصی موبایل ────────────────────────────────
    const sim_count   = toNumber(top_map["تعداد سیم‌کارت"]);
    const originality = top_map["اصالت برند"] || we.originality || null;

    // 🔴 این چهار فیلد قبلاً همیشه null بودند، حتی برای آگهی‌های تبلت — یعنی
    // برند، اندازه‌ی صفحه، سیستم‌عامل و نوع اتصال هیچ تبلتی ذخیره نمی‌شد.
    // ── فیلدهای اختصاصی تبلت — برای شاخه‌ی موبایل null می‌مانند ────
    const isTablet = category === "tablet";
    const manufacturer    = isTablet ? (top_map["سازنده"] || top_map["برند"] || top_map["برند و مدل"] || modal_map["سازنده"] || modal_map["برند"] || null) : null;
    const screen_size     = isTablet ? (top_map["اندازهٔ صفحه"] || null) : null;
    const os               = isTablet ? (top_map["سیستم عامل"] || null) : null;
    const connection_type = isTablet ? (modal_map["نوع اتصال"] || null) : null;

    // ── فیلدهای مودال مشترک هر دو ─────────────────────────────
    const camera_condition = modal_map["وضعیت دوربین"] || modal_map["وضعیت دوربین ها"] || null;
    const screen_condition = modal_map["وضعیت صفحه‌نمایش"] || null;
    const body_condition   = modal_map["وضعیت بدنه"] || null;
    const box_status       = modal_map["وضعیت جعبه دستگاه"] || null;

    // ── فیلدهای مودال اختصاصی موبایل ──────────────────────────
    const battery_health      = modal_map["سلامت باتری"] || null;
    const ownership_transfer  = modal_map["انتقال مالکیت"] || null;

    // ── فیلدهای مودال اختصاصی تبلت — null برای شاخه موبایل ────
    const adapter        = null;
    const charging_cable = null;

    // ── متادیتا از webengage ───────────────────────────────────
    const business_type = we.business_type || "";
    const district_slug = we.district      || "";
    const image_count   = we.image_count   || 0;
    const brand_model   = we.brand_model   || null;
    const city_name     = (raw.city?.name || process.env.SOURCE_CITY_NAME || null);

    const AGENCY_TYPES = ["real-estate-agency", "premium-panel", "shop"];
    const seller_type  = AGENCY_TYPES.includes(business_type) ? "فروشگاه/آژانس" : "شخصی";

    // ── توضیحات ──────────────────────────────────────────────
    const descWidget  = findWidget("DESCRIPTION_ROW");
    const description = descWidget?.data?.text || "";

    // ── specs_text — برای تشخیص ویرایش/تکراری در Check Status ──
    const specs = [];
    if (price)              specs.push(`price:${price}`);
    if (status_persian)     specs.push(`status:${status_persian}`);
    if (internal_storage)   specs.push(`storage:${internal_storage}`);
    if (ram)                specs.push(`ram:${ram}`);
    if (color)               specs.push(`color:${color}`);
    if (device_condition)    specs.push(`condition:${device_condition}`);
    const specs_text = specs.join(" | ");

    return [{
      json: {
        token,
        title,
        category,
        cat_1,
        cat_2,
        cat_3,
        category_persian,
        breadcrumb_full,
        status_en,
        unavailable_after,
        link: raw.share?.web_url || sourceLink(token),
        specs_text,
        status: status_persian,
        device_condition,
        brand_model,
        internal_storage,
        ram,
        color,
        price,
        price_note,
        sim_count,
        originality,
        manufacturer,
        screen_size,
        os,
        connection_type,
        camera_condition,
        screen_condition,
        body_condition,
        box_status,
        battery_health,
        ownership_transfer,
        adapter,
        charging_cable,
        location:     neighborhood_persian,
        neighborhood: neighborhood_persian,
        district_slug,
        city: city_name,
        latitude,
        longitude,
        seller_type,
        business_type,
        image_count,
        description,
        all_specs_json,
        is_broadcasted: 0
      }
    }];

  })();
  if (Array.isArray(__result)) {
    const r0 = __result[0];
    return r0 && typeof r0 === 'object' && 'json' in r0 ? r0.json : r0;
  }
  return __result; // بعضی نودهای اصلی به‌جای [{json:X}] مستقیم X را برمی‌گردانند
}
