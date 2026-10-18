// ساکت‌کردن console هنگام اجرای یک کار و برگرداندن خروجی‌اش (برای بررسی پیام‌ها در تست)
export async function quiet(fn) {
  const logs = [];
  const errs = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const result = await fn();
    return { result, logs, errs, text: [...logs, ...errs].join('\n') };
  } finally {
    console.log = ol;
    console.error = oe;
  }
}
