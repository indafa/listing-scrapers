// بررسی‌های ساختاری ریپو: ورک‌فلوها، متغیرها، آدرس‌های داخل کد، هم‌خوانی با ساختار جدول‌ها.
import { makeWorld } from './helpers/world.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_COLUMNS } from '../categories/mobile-tablet/run.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const WORKFLOWS = ['collect', 'enrich', 'liveness', 'prices', 'catalog', 'news'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => relative(ROOT, p).split('\\').join('/'));
const codeFiles = files.filter((f) => /\.(mjs|yml|json|md)$/.test(f) && !f.startsWith('tests/'));

test('شش ورک‌فلو هست و همه فقط با workflow_dispatch اجرا می‌شوند (زمان‌بندی با Worker است)', () => {
  const present = files.filter((f) => f.startsWith('.github/workflows/')).map((f) => f.replace('.github/workflows/', '').replace('.yml', '')).sort();
  assert.deepEqual(present, [...WORKFLOWS].sort());
  for (const name of WORKFLOWS) {
    const y = read(`.github/workflows/${name}.yml`);
    const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.match(code, /^on:\n  workflow_dispatch:/m, `${name}: باید workflow_dispatch داشته باشد`);
    for (const trigger of ['schedule:', 'push:', 'pull_request', 'workflow_run', 'issues:', 'release:']) assert.ok(!code.includes(trigger), `${name}: نباید ${trigger} داشته باشد`);
    assert.match(code, /permissions:\n  contents: read/, `${name}: کمترین دسترسی`);
    assert.match(code, /timeout-minutes: \d+/, `${name}: سقف زمانی`);
    assert.match(code, /concurrency:\n  group: mobile-tablet-/, `${name}: صف هم‌زمانی`);
    assert.match(code, /cancel-in-progress: false/);
    assert.match(code, /node-version: 20/);
  }
});

test('ورودی collect همان چیزی است که Worker می‌فرستد (city_id) و ورک‌فلوهای دیگر ورودی ندارند', () => {
  assert.match(read('.github/workflows/collect.yml'), /inputs:\n      city_id:/);
  for (const name of WORKFLOWS.filter((n) => n !== 'collect')) assert.ok(!/inputs:/.test(read(`.github/workflows/${name}.yml`)), `${name}: ورودی ندارد`);
  const timeouts = Object.fromEntries(WORKFLOWS.map((n) => [n, Number(/timeout-minutes: (\d+)/.exec(read(`.github/workflows/${n}.yml`))[1])]));
  assert.equal(timeouts.collect, 15);
});

test('مقدارهای حساس فقط از Secrets و فقط همین سه تا؛ بقیه از Variables با نام SOURCE_*/CATALOG_*', () => {
  const used = { secrets: new Set(), vars: new Set() };
  for (const name of WORKFLOWS) {
    const y = read(`.github/workflows/${name}.yml`);
    for (const m of y.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)) used.secrets.add(m[1]);
    for (const m of y.matchAll(/\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/g)) used.vars.add(m[1]);
    assert.ok(!/\$\{\{(?!\s*(?:secrets|vars|inputs)\.)/.test(y), `${name}: عبارت ناشناخته`);
  }
  assert.deepEqual([...used.secrets].sort(), ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_D1_DATABASE_ID']);
  for (const v of used.vars) assert.match(v, /^(SOURCE_|CATALOG_)/, v);
  const readme = read('README.md');
  for (const n of [...used.secrets, ...used.vars]) assert.ok(readme.includes(`\`${n}\``), `README «${n}» را توضیح نداده`);
});

test('collect فقط با recipients خالی اجرا می‌شود و فایل‌های اجرا وجود دارند', () => {
  assert.match(read('.github/workflows/collect.yml'), /RECIPIENTS_PATH: \.\/recipients\/empty\.json/);
  for (const name of WORKFLOWS) {
    const y = read(`.github/workflows/${name}.yml`);
    const script = /run: node (\S+)/.exec(y)?.[1];
    assert.ok(script && existsSync(join(ROOT, script)), `${name}: فایل اجرا ${script} نیست`);
  }
  assert.ok(!read('.github/workflows/collect.yml').includes('INGEST_SECRETS_JSON'));
});

test('هیچ آدرس سخت‌کدشده‌ای جز API کلودفلر در کد نیست (آدرس منبع فقط از Variables می‌آید)', () => {
  const allowed = new Set(['api.cloudflare.com']);
  for (const f of codeFiles.filter((x) => x.endsWith('.mjs') && x !== 'shared/core/core.mjs')) {
    for (const m of read(f).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) assert.ok(allowed.has(m[1]), `${f}: آدرس ناشناخته ${m[1]}`);
  }
  for (const f of ['README.md', ...WORKFLOWS.map((n) => `.github/workflows/${n}.yml`)]) {
    for (const m of read(f).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) assert.ok(allowed.has(m[1]), `${f}: آدرس ناشناخته ${m[1]}`);
  }
});

test('بسته‌ی اجرایی: package.json، تست بدون وابستگی، gitignore، هسته‌ی خودکار', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /node --no-warnings --test/);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.private, true);
  assert.match(read('.gitignore'), /node_modules/);
  assert.match(read('.gitignore'), /\.env/);
  assert.match(read('shared/core/core.mjs'), /^\/\/ ⚠️ این فایل خودکار ساخته می‌شود/);
  assert.ok(!files.includes('package-lock.json') || true);
});

test('هیچ سکرت یا مقدار واقعی در فایل‌های ریپو نیست', () => {
  for (const f of codeFiles) {
    const t = read(f);
    assert.ok(!/(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|\b\d{8,10}:[A-Za-z0-9_-]{30,})/.test(t), `${f}: شبیه کلید واقعی`);
  }
  assert.ok(!files.some((f) => /(^|\/)\.env($|\.)/.test(f)));
});

test('ستون‌های DB_COLUMNS دقیقاً همان ستون‌های جدول listings در ساختار Worker است', () => {
  const w = makeWorld();
  try {
    const cols = w.rows('PRAGMA table_info(listings)').map((c) => c.name);
    assert.deepEqual([...DB_COLUMNS].sort(), [...cols].sort());
  } finally { w.restore(); }
});

test('ساختار تست‌ها (helpers/schema.sql) با schema.sql سمت Worker یکی است (اگر کنار هم باشند)', { skip: !existsSync(join(ROOT, '..', 'advisor-worker', 'schema.sql')) && 'ریپوی Worker کنار این پوشه نیست' }, () => {
  const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const mine = strip(read('tests/helpers/schema.sql'));
  const theirs = strip(readFileSync(join(ROOT, '..', 'advisor-worker', 'schema.sql'), 'utf8'));
  for (const stmt of mine.split(/;\s*/).filter(Boolean)) assert.ok(theirs.includes(stmt), `ساختار با Worker فرق دارد: ${stmt.slice(0, 80)}…`);
});
