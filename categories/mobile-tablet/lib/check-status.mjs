// وضعیت آگهی نسبت به رکورد قبلی: new (تازه) | edited (قیمت/مشخصات عوض شده) | seen (بدون تغییر).
export function checkStatus(parsed, dbRecord) {
  const $ = (nodeName) => {
    if (nodeName === "Code: Parse Details") return { item: { json: parsed } };
    throw new Error('checkStatus shim: unexpected node ref ' + nodeName);
  };
  const $input = { item: { json: dbRecord || {} } };
  const __result = (() => {
    const parsed = $('Code: Parse Details').item.json;
    const now = new Date().toISOString();

    // نتیجه Data Table Get — اگه رکورد وجود داشت token داره، وگرنه خالیه
    const dbRecord = $input.item.json;
    const isExisting = !!(dbRecord && dbRecord.token);

    let status, is_broadcasted, first_seen, last_seen, edit_count;

    if (!isExisting) {
      // ── آگهی جدید — اولین بار دیده شده ──────────────────────
      status         = 'new';
      is_broadcasted = 0;
      first_seen     = now;
      last_seen      = now;
      edit_count     = 0;

    } else {
      const old_specs = (dbRecord.specs_text || '').trim();
      const new_specs = (parsed.specs_text  || '').trim();

      first_seen = dbRecord.first_seen || now;
      last_seen  = now;

      if (old_specs !== new_specs) {
        // ── ویرایش شده — قیمت یا مشخصات تغییر کرده ───────────
        status         = 'edited';
        is_broadcasted = 0;     // دوباره باید به کاربران اطلاع داده بشه
        edit_count     = (Number(dbRecord.edit_count) || 0) + 1;

      } else {
        // ── تکراری — هیچ چیزی تغییر نکرده ────────────────────
        status         = 'seen';
        is_broadcasted = Number(dbRecord.is_broadcasted ?? 1); // دست نخور
        edit_count     = Number(dbRecord.edit_count) || 0;
      }
    }

    return [{
      json: {
        ...parsed,
        status,
        is_broadcasted,
        first_seen,
        last_seen,
        edit_count
      }
    }];

  })();
  if (Array.isArray(__result)) {
    const r0 = __result[0];
    return r0 && typeof r0 === 'object' && 'json' in r0 ? r0.json : r0;
  }
  return __result; // بعضی نودهای اصلی به‌جای [{json:X}] مستقیم X را برمی‌گردانند
}
