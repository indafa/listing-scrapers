// ⚠️ این فایل خودکار ساخته می‌شود؛ دستی ویرایش نکنید.
// منبع: advisor-worker/src/core/*.ts  ·  ساخت: node scripts/sync-core.mjs

// src/core/text.ts
function toAsciiDigits(s) {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}
function toFaDigits(s) {
  return s.replace(/[0-9]/g, (d) => "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9"[Number(d)]);
}
function fmtNum(n) {
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u066C");
  return sign + toFaDigits(s);
}
function fmtToman(n) {
  if (n === null || n === void 0 || !isFinite(n)) return "\u0646\u0627\u0645\u0634\u062E\u0635";
  return `${fmtNum(n)} \u062A\u0648\u0645\u0627\u0646`;
}
function normFa(input) {
  let s = toAsciiDigits(String(input ?? "").normalize("NFKC"));
  s = s.replace(/ي/g, "\u06CC").replace(/ك/g, "\u06A9").replace(/ۀ|ة/g, "\u0647").replace(/ؤ/g, "\u0648").replace(/إ|أ/g, "\u0627");
  s = s.replace(/[\u0640\u064B-\u065F\u0670]/g, "");
  s = s.replace(/[\u200c\u200d\u200e\u200f]/g, " ");
  s = s.toLowerCase();
  s = s.replace(/٫/g, ".").replace(/٬/g, ",");
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1").replace(/(\d),(?=\d{1,2}(?!\d))/g, "$1.");
  s = s.replace(/([0-9])\s*\/\s*([0-9])/g, "$1 / $2");
  s = s.replace(/[^\p{L}\p{N}\/+.]+/gu, " ").replace(/(?<![0-9])\.|\.(?![0-9])/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
var NOISE = /* @__PURE__ */ new Set([
  "\u06AF\u0648\u0634\u06CC",
  "\u0645\u0648\u0628\u0627\u06CC\u0644",
  "\u062A\u0628\u0644\u062A",
  "\u062F\u0633\u062A\u06AF\u0627\u0647",
  "\u0645\u062F\u0644",
  "\u0627\u0635\u0644\u06CC",
  "\u0627\u0648\u0631\u062C\u06CC\u0646\u0627\u0644",
  "\u0631\u062C\u06CC\u0633\u062A\u0631",
  "\u0631\u062C\u06CC\u0633\u062A\u0631\u06CC",
  "\u0634\u062F\u0647",
  "\u06AF\u0627\u0631\u0627\u0646\u062A\u06CC",
  "\u062F\u0627\u0631\u0627\u06CC",
  "\u0628\u0627",
  "\u0648",
  "\u0628\u0647",
  "\u0642\u06CC\u0645\u062A",
  "\u0686\u0646\u062F\u0647",
  "\u0686\u0646\u062F",
  "\u0645\u06CC",
  "\u062E\u0648\u0627\u0645",
  "\u0645\u06CC\u062E\u0648\u0627\u0645",
  "\u0645\u06CC\u062E\u0648\u0627\u0633\u062A\u0645",
  "\u0646\u06CC\u0627\u0632",
  "\u062A\u0648\u0645\u0627\u0646",
  "\u062A\u0648\u0645\u0646",
  "\u0631\u06CC\u0627\u0644",
  "\u06CC\u0647",
  "\u06CC\u06A9",
  "\u0644\u0637\u0641\u0627",
  "\u0633\u0644\u0627\u0645",
  "\u0645\u0645\u0646\u0648\u0646",
  "\u062F\u0627\u0631\u06CC\u062F",
  "\u062F\u0627\u0631\u06CC\u0646",
  "\u0645\u0648\u062C\u0648\u062F\u0647",
  "\u0645\u0648\u062C\u0648\u062F",
  "\u0647\u0633\u062A",
  "\u0645\u06CC\u0634\u0647",
  "\u0628\u0631\u0627\u06CC",
  "\u0627\u0632",
  "\u062F\u0631",
  "\u06A9\u0647",
  "\u0631\u0627",
  "\u0631\u0648",
  "\u0647\u0645",
  "\u0627\u06CC\u0646\u0645",
  "\u06A9\u062F",
  "\u0627\u06A9\u062A\u06CC\u0648",
  "\u067E\u0644\u0645\u067E",
  "\u0622\u06A9\u0628\u0646\u062F",
  "\u0627\u06A9\u0628\u0646\u062F",
  "\u0646\u0648",
  "\u06A9\u0627\u0631\u06A9\u0631\u062F\u0647",
  "\u0627\u0633\u062A\u0648\u06A9",
  "\u062F\u0633\u062A",
  "\u062F\u0648\u0645",
  "\u062D\u062F",
  "\u0633\u06CC\u0645",
  "\u06A9\u0627\u0631\u062A",
  "\u062F\u0648",
  "\u062A\u06A9",
  "\u0627\u06CC\u0631\u0627\u0646",
  "\u062C\u062F\u06CC\u062F",
  "\u0645\u062F\u0644\u0634",
  "\u06A9\u0627\u0645\u0644",
  "\u0633\u0627\u0644\u0645",
  "phone",
  "mobile",
  "tablet",
  "the",
  "new",
  "used",
  "5g",
  "4g",
  "3g",
  "lte",
  "wifi",
  "cellular",
  "dual",
  "sim",
  "esim",
  "gb",
  "tb",
  "g",
  "\u06AF\u06CC\u06AF",
  "\u06AF\u06CC\u06AF\u0627\u0628\u0627\u06CC\u062A",
  "\u062A\u0631\u0627\u0628\u0627\u06CC\u062A",
  "\u0631\u0645",
  "ram",
  "\u0648\u0627\u06CC",
  "\u0641\u0627\u06CC",
  "\u0633\u0644\u0648\u0644\u0627\u0631"
]);
var FA2EN = {
  \u0627\u06CC\u0641\u0648\u0646: "iphone",
  \u0622\u06CC\u0641\u0648\u0646: "iphone",
  \u0627\u06CC\u067E\u062F: "ipad",
  \u0622\u06CC\u067E\u062F: "ipad",
  \u06AF\u0644\u06A9\u0633\u06CC: "galaxy",
  \u06AF\u0627\u0644\u06A9\u0633\u06CC: "galaxy",
  \u06AF\u0644\u0627\u06A9\u0633\u06CC: "galaxy",
  \u0631\u062F\u0645\u06CC: "redmi",
  \u0631\u06CC\u062F\u0645\u06CC: "redmi",
  \u067E\u0648\u06A9\u0648: "poco",
  \u0646\u0648\u062A: "note",
  \u067E\u0631\u0648: "pro",
  \u0645\u06A9\u0633: "max",
  \u0627\u0648\u0644\u062A\u0631\u0627: "ultra",
  \u0627\u0644\u062A\u0631\u0627: "ultra",
  \u067E\u0644\u0627\u0633: "plus",
  \u0644\u0627\u06CC\u062A: "lite",
  \u0645\u06CC\u0646\u06CC: "mini",
  \u0627\u06CC\u0631: "air",
  \u0641\u0648\u0644\u062F: "fold",
  \u0641\u0644\u06CC\u067E: "flip",
  \u067E\u06CC\u06A9\u0633\u0644: "pixel",
  \u0646\u0626\u0648: "neo",
  \u0646\u06CC\u0648: "neo",
  \u0627\u062C: "edge",
  \u062A\u0628: "tab",
  \u067E\u0631\u0627\u06CC\u0645: "prime",
  \u062A\u0648\u0631\u0628\u0648: "turbo",
  \u0627\u0633: "s",
  \u0627\u06CC: "a",
  \u0627\u0645: "m",
  \u0627\u0641: "f",
  \u0627\u06CC\u06A9\u0633: "x",
  \u0632\u062F: "z",
  \u062C\u06CC: "g",
  \u0633\u0627\u0645\u0633\u0648\u0646\u06AF: "samsung",
  \u0633\u0627\u0645\u0633\u0648\u0646\u062C: "samsung",
  \u0627\u067E\u0644: "apple",
  \u0634\u06CC\u0627\u0626\u0648\u0645\u06CC: "xiaomi",
  \u0634\u06CC\u0627\u0648\u0645\u06CC: "xiaomi",
  \u0634\u0627\u06CC\u0648\u0645\u06CC: "xiaomi",
  \u0634\u06CC\u0627\u0645\u06CC: "xiaomi",
  \u0647\u0648\u0627\u0648\u06CC: "huawei",
  \u0647\u0648\u0622\u0648\u06CC: "huawei",
  \u0647\u0648\u0627\u06CC\u06CC: "huawei",
  \u0622\u0646\u0631: "honor",
  \u0627\u0646\u0631: "honor",
  \u0646\u0648\u06A9\u06CC\u0627: "nokia",
  \u0645\u0648\u062A\u0648\u0631\u0648\u0644\u0627: "motorola",
  \u0648\u0627\u0646\u067E\u0644\u0627\u0633: "oneplus",
  \u0627\u0648\u067E\u0648: "oppo",
  \u0648\u06CC\u0648\u0648: "vivo",
  \u0631\u06CC\u0644\u0645\u06CC: "realme",
  \u0627\u06CC\u0646\u0641\u06CC\u0646\u06CC\u06A9\u0633: "infinix",
  \u062A\u06A9\u0646\u0648: "tecno",
  \u06AF\u0648\u06AF\u0644: "google",
  \u0633\u0648\u0646\u06CC: "sony",
  \u0627\u06CC\u0633\u0648\u0633: "asus",
  \u0644\u0646\u0648\u0648: "lenovo",
  \u0646\u0627\u062A\u06CC\u0646\u06AF: "nothing",
  \u0646\u0648\u0627: "nova",
  \u0645\u06CC\u062A: "mate",
  \u0645\u062C\u06CC\u06A9: "magic",
  \u0627\u0633\u067E\u0627\u0631\u06A9: "spark",
  \u0647\u0627\u062A: "hot",
  \u0632\u06CC\u0631\u0648: "zero",
  \u06A9\u0627\u0645\u0648\u0646: "camon",
  \u062A\u06CC: "t",
  \u0633\u06CC: "c",
  \u067E\u06CC: "p"
};
var FA2EN_BIGRAM = {
  "\u0627\u0641 \u0627\u06CC": "fe",
  "\u0627\u0633 \u0627\u06CC": "se",
  "\u062C\u06CC \u062A\u06CC": "gt",
  "\u0648\u0627\u0646 \u067E\u0644\u0627\u0633": "oneplus",
  "\u0627\u06CC\u06A9\u0633 \u0622\u0631": "xr",
  "\u0627\u06CC\u06A9\u0633 \u0627\u0633": "xs"
};
var FA2EN_SPLIT = {
  \u067E\u0631\u0648\u0645\u06A9\u0633: ["pro", "max"],
  \u067E\u0631\u0648\u0645\u0627\u06A9\u0633: ["pro", "max"],
  promax: ["pro", "max"],
  \u067E\u0631\u0648\u067E\u0644\u0627\u0633: ["pro", "plus"],
  proplus: ["pro", "plus"]
};
var BRANDS = /* @__PURE__ */ new Set([
  "apple",
  "samsung",
  "xiaomi",
  "huawei",
  "honor",
  "nokia",
  "motorola",
  "oneplus",
  "oppo",
  "vivo",
  "realme",
  "infinix",
  "tecno",
  "google",
  "sony",
  "asus",
  "lenovo",
  "nothing"
]);
var SERIES_BRAND = {
  iphone: "apple",
  ipad: "apple",
  galaxy: "samsung",
  redmi: "xiaomi",
  poco: "xiaomi",
  pixel: "google"
};
var TIER = /* @__PURE__ */ new Set(["pro", "max", "plus", "ultra", "fe", "lite", "mini", "neo", "note", "fold", "flip", "air", "se", "gt", "edge", "prime", "turbo", "xr", "xs"]);
var REGIONS = /* @__PURE__ */ new Set(["ch", "za", "ll", "ja", "zd", "hn", "cn"]);
var COLORS = [
  ["natural titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0637\u0628\u06CC\u0639\u06CC", "natural titanium", "\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0646\u0686\u0631\u0627\u0644"]],
  ["desert titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0635\u062D\u0631\u0627\u06CC\u06CC", "desert titanium", "\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u062F\u0632\u0631\u062A"]],
  ["white titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0633\u0641\u06CC\u062F", "white titanium"]],
  ["black titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0645\u0634\u06A9\u06CC", "black titanium"]],
  ["blue titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645 \u0622\u0628\u06CC", "blue titanium"]],
  ["titanium", ["\u062A\u06CC\u062A\u0627\u0646\u06CC\u0648\u0645", "titanium"]],
  ["black", ["\u0645\u0634\u06A9\u06CC", "\u0633\u06CC\u0627\u0647", "\u0628\u0644\u06A9", "black", "space black", "\u0627\u0633\u067E\u06CC\u0633 \u0628\u0644\u06A9"]],
  ["white", ["\u0633\u0641\u06CC\u062F", "\u0648\u0627\u06CC\u062A", "white"]],
  ["blue", ["\u0622\u0628\u06CC", "\u0627\u0628\u06CC", "\u0628\u0644\u0648", "blue"]],
  ["red", ["\u0642\u0631\u0645\u0632", "\u0631\u062F", "red"]],
  ["green", ["\u0633\u0628\u0632", "\u06AF\u0631\u06CC\u0646", "green"]],
  ["yellow", ["\u0632\u0631\u062F", "\u06CC\u0644\u0648", "yellow"]],
  ["purple", ["\u0628\u0646\u0641\u0634", "\u067E\u0631\u067E\u0644", "purple", "\u06CC\u0627\u0633\u06CC", "lavender", "\u0644\u0648\u0646\u06CC"]],
  ["pink", ["\u0635\u0648\u0631\u062A\u06CC", "\u067E\u06CC\u0646\u06A9", "pink"]],
  ["gray", ["\u062E\u0627\u06A9\u0633\u062A\u0631\u06CC", "\u0637\u0648\u0633\u06CC", "\u06AF\u0631\u06CC", "gray", "grey", "\u06AF\u0631\u0627\u0641\u06CC\u062A\u06CC", "graphite"]],
  ["silver", ["\u0646\u0642\u0631\u0647 \u0627\u06CC", "\u0646\u0642\u0631\u0647", "\u0633\u06CC\u0644\u0648\u0631", "silver"]],
  ["gold", ["\u0637\u0644\u0627\u06CC\u06CC", "\u0637\u0644\u0627", "\u06AF\u0644\u062F", "gold"]],
  ["orange", ["\u0646\u0627\u0631\u0646\u062C\u06CC", "\u0627\u0648\u0631\u0646\u062C", "orange", "\u0646\u0627\u0631\u0646\u062C\u06CC \u06A9\u06CC\u0647\u0627\u0646\u06CC"]],
  ["brown", ["\u0642\u0647\u0648\u0647 \u0627\u06CC", "\u0642\u0647\u0648\u0647", "brown"]],
  ["cream", ["\u06A9\u0631\u0645", "cream", "beige", "\u0628\u0698"]],
  ["midnight", ["\u0645\u06CC\u062F\u0646\u0627\u06CC\u062A", "\u0646\u06CC\u0645\u0647 \u0634\u0628", "midnight"]],
  ["starlight", ["\u0627\u0633\u062A\u0627\u0631\u0644\u0627\u06CC\u062A", "starlight"]],
  ["teal", ["\u0633\u0628\u0632\u0622\u0628\u06CC", "\u0633\u0628\u0632 \u0622\u0628\u06CC", "teal", "\u0641\u06CC\u0631\u0648\u0632\u0647 \u0627\u06CC", "\u0641\u06CC\u0631\u0648\u0632\u0647"]]
];
function tokenize(norm) {
  const out = [];
  for (const raw of norm.split(" ")) {
    if (!raw || raw === "/" || raw === "+") continue;
    const m = raw.match(/\p{L}+|\p{N}+/gu);
    if (m) out.push(...m);
  }
  return out;
}
function canonTokens(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const split = FA2EN_SPLIT[tokens[i]];
    if (split) {
      out.push(...split);
      continue;
    }
    const bi = tokens[i] + " " + (tokens[i + 1] ?? "");
    if (FA2EN_BIGRAM[bi]) {
      out.push(FA2EN_BIGRAM[bi]);
      i++;
      continue;
    }
    out.push(FA2EN[tokens[i]] ?? tokens[i]);
  }
  return out;
}
var STORAGES = /* @__PURE__ */ new Set([16, 32, 64, 128, 256, 512, 1024, 2048]);
function parseBudget(input) {
  const norm = normFa(input);
  const re = /(\d+(?:[.,]\d+)?)\s*(میلیون\w*|ملیون\w*|میل|هزار\w*|تومان\w*|تومن\w*)/;
  const m = norm.match(re);
  if (!m) return { value: null, rest: norm };
  let v = parseFloat(m[1].replace(",", "."));
  const unit = m[2];
  if (/^(میلیون|ملیون|میل)/.test(unit)) v *= 1e6;
  else if (/^هزار/.test(unit)) v *= 1e3;
  else if (v < 1e4) return { value: null, rest: norm };
  return { value: Math.round(v), rest: norm.replace(m[0], " ").replace(/\s+/g, " ").trim() };
}
var UNIT_END = "(?![a-z0-9\\u0600-\\u06FF])";
var RE_TB = new RegExp(`\\b(\\d{1,4})\\s*(tb|\u062A\u0631\u0627\u0628\u0627\u06CC\u062A|\u062A\u06CC \u0628\u06CC)${UNIT_END}`);
var RE_GB = new RegExp(`\\b(\\d{2,4})\\s*(gb|g|\u06AF\u06CC\u06AF\u0627\u0628\u0627\u06CC\u062A|\u06AF\u06CC\u06AF)${UNIT_END}`);
var RE_RAM = new RegExp(`\\b(\\d{1,2})\\s*(?:gb|g|\u06AF\u06CC\u06AF)?\\s*(?:ram|\u0631\u0645)${UNIT_END}`);
var COLOR_RES = null;
function colorPatterns() {
  if (COLOR_RES) return COLOR_RES;
  const entries = [];
  for (const [canon, vars] of COLORS) for (const v of vars) entries.push([canon, normFa(v)]);
  entries.sort((a, b2) => b2[1].length - a[1].length);
  COLOR_RES = entries.map(([canon, v]) => [canon, new RegExp(`(?:^| )${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= |$)`)]);
  return COLOR_RES;
}
function parseQuery(text) {
  let n = normFa(text);
  const b = parseBudget(n);
  n = b.rest;
  let ramGb = null;
  let storageGb = null;
  let m = n.match(/\b(\d{1,2})\s*(?:\/|به)\s*(\d{2,4})\b/);
  if (m && STORAGES.has(Number(m[2])) && Number(m[1]) <= 32) {
    ramGb = Number(m[1]);
    storageGb = Number(m[2]);
    n = n.replace(m[0], " ");
  }
  m = n.match(RE_TB);
  if (m) {
    storageGb = Number(m[1]) * 1024;
    n = n.replace(m[0], " ");
  } else {
    m = n.match(RE_GB);
    if (m && STORAGES.has(Number(m[1]))) {
      if (storageGb === null) storageGb = Number(m[1]);
      n = n.replace(m[0], " ");
    }
  }
  m = n.match(RE_RAM);
  if (m && ramGb === null) {
    ramGb = Number(m[1]);
    n = n.replace(m[0], " ");
  }
  let color = null;
  for (const [canon, re] of colorPatterns()) {
    if (re.test(n)) {
      color = canon;
      n = n.replace(re, " ");
      break;
    }
  }
  let cond = null;
  if (/(?:^| )در حد نو(?: |$)|درحدنو|لایک نو/.test(n)) {
    cond = "likenew";
    n = n.replace(/در حد نو|درحدنو|لایک نو/g, " ");
  } else if (/(?:^| )(کارکرده|استوک|دست دوم|used)(?: |$)/.test(n)) {
    cond = "used";
    n = n.replace(/کارکرده|استوک|دست دوم|\bused\b/g, " ");
  } else if (/(?:^| )(پلمپ|آکبند|اکبند|sealed|نو)(?: |$)/.test(n)) {
    cond = "new";
  }
  let toks = canonTokens(tokenize(n));
  let region = null;
  toks = toks.filter((t) => {
    if (REGIONS.has(t) && toks.length > 2) {
      region = t;
      return false;
    }
    return true;
  });
  const brandHits = toks.filter((t) => BRANDS.has(t));
  let brand = brandHits[0] ?? null;
  const model = toks.filter((t) => !BRANDS.has(t) && !NOISE.has(t));
  if (!brand) {
    for (const t of model) if (SERIES_BRAND[t]) {
      brand = SERIES_BRAND[t];
      break;
    }
  }
  if (storageGb === null) {
    const isNum = (t) => /^\d+$/.test(t);
    for (let i = model.length - 1; i > 0; i--) {
      const t = model[i];
      if (!isNum(t) || !STORAGES.has(Number(t))) continue;
      const before = model.slice(0, i);
      if (!before.some((x) => /\d/.test(x) || x.length > 2)) continue;
      if (before.some(isNum) || Number(t) >= 64) {
        storageGb = Number(t);
        model.splice(i, 1);
      }
      break;
    }
  }
  const modelTokens = model.filter((t) => !/^\d{5,}$/.test(t));
  return { norm: n.trim(), modelTokens, brand, storageGb, ramGb, color, region, cond, budget: b.value };
}
function splitMessage(text, limit = 3800) {
  if (text.length <= limit) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(". ", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.3) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
async function sha1Hex(s) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/core/match.ts
var AUTO_THRESHOLD = 0.85;
var MID_THRESHOLD = 0.6;
function nameTokens(name) {
  return canonTokens(tokenize(normFa(name)));
}
function candidateTokenSet(c) {
  const s = /* @__PURE__ */ new Set();
  for (const t of c.name_tokens) if (!BRANDS.has(t)) s.add(t);
  for (const t of c.alias_tokens ?? []) s.add(t);
  return s;
}
var setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
function scoreCandidate(q, c) {
  const reasons = [];
  const C = candidateTokenSet(c);
  const I = new Set(q.modelTokens);
  if (I.size === 0) return { model_id: c.model_id, score: 0, suspicious: true, reasons: ["empty"] };
  const impliedBrand = q.brand;
  if (impliedBrand && c.brand && impliedBrand !== c.brand) return { model_id: c.model_id, score: 0, suspicious: true, reasons: ["brand"] };
  const nums = (s) => new Set([...s].filter((t) => /^\d+$/.test(t)));
  const inNums = nums(I);
  const cNums = nums(new Set(c.name_tokens));
  if (inNums.size && !setEq(inNums, cNums)) {
    if (cNums.size) return { model_id: c.model_id, score: 0, suspicious: true, reasons: ["gen-number"] };
  }
  if (!inNums.size && cNums.size) reasons.push("no-gen-number");
  const tier = (s) => new Set([...s].filter((t) => TIER.has(t)));
  const inTier = tier(I);
  const cTier = tier(new Set(c.name_tokens));
  for (const t of c.alias_tokens ?? []) if (TIER.has(t)) cTier.add(t);
  if (!setEq(inTier, cTier)) return { model_id: c.model_id, score: 0, suspicious: true, reasons: ["tier"] };
  const inter = [...I].filter((t) => C.has(t)).length;
  const cov = inter / I.size;
  const spec = C.size ? inter / C.size : 0;
  const name = 0.6 * cov + 0.4 * spec;
  const brandAgree = q.brand ? 1 : 0.8;
  const numAgree = inNums.size ? 1 : 0.7;
  let storageOk = 1;
  let suspicious = false;
  if (q.storageGb !== null && c.storages && c.storages.length && !c.storages.includes(q.storageGb)) {
    storageOk = 0;
    suspicious = true;
    reasons.push("storage-not-offered");
  }
  if (q.ramGb !== null && c.rams && c.rams.length && !c.rams.includes(q.ramGb)) {
    suspicious = true;
    reasons.push("ram-not-offered");
  }
  const score = Math.max(0, Math.min(1, 0.5 * name + 0.2 * brandAgree + 0.15 * numAgree + 0.15 * storageOk));
  return { model_id: c.model_id, score: Math.round(score * 1e3) / 1e3, suspicious, reasons };
}
function rank(q, cands) {
  const scored = cands.map((c) => scoreCandidate(q, c)).filter((s) => s.score > 0).sort((a2, b2) => b2.score - a2.score);
  const top = scored.slice(0, 5);
  if (!top.length) return { kind: "unmatched", top };
  const [a, b] = top;
  const gap = b ? a.score - b.score : 1;
  if (a.score >= AUTO_THRESHOLD && !a.suspicious && gap >= 0.05) return { kind: "auto", best: a, top };
  if (a.score >= AUTO_THRESHOLD && gap < 0.05) return { kind: "ambiguous", best: a, top };
  if (a.score >= MID_THRESHOLD) return { kind: "verify", best: a, top };
  return { kind: "unmatched", top };
}
function slug(s) {
  return tokenize(normFa(s)).join("_");
}
function modelIdFrom(brand, name) {
  const toks = canonTokens(tokenize(normFa(name))).filter((t) => !BRANDS.has(t));
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^[a-z]{1,2}$/.test(t) && !TIER.has(t) && /^\d+$/.test(toks[i + 1] ?? "")) {
      out.push(t + toks[i + 1]);
      i++;
    } else out.push(t);
  }
  return `${brand}_${out.join("_")}`.replace(/_+/g, "_");
}
function variantKey(modelId, storageGb, color) {
  return `${modelId}|${storageGb ? storageGb + "gb" : ""}|${color ? color.replace(/\s+/g, "-") : ""}`;
}
function parseVariantKey(k) {
  const [m, s, c] = k.split("|");
  return { model_id: m, storage_gb: s ? parseInt(s) : null, color: c ? c.replace(/-/g, " ") : null };
}
function matchText(text, cands) {
  const q = parseQuery(text);
  return { q, d: rank(q, cands) };
}
function inferBrand(name) {
  const t = canonTokens(tokenize(normFa(name)));
  for (const x of t) if (BRANDS.has(x)) return x;
  for (const x of t) if (SERIES_BRAND[x]) return SERIES_BRAND[x];
  return null;
}

// src/core/features.ts
var HARD_FLAGS = ["icloud_locked", "not_registered", "broken", "parts_only", "installment_price", "exchange_offer", "negotiable_price", "network_locked"];
var DEFAULT_WEIGHTS = {
  body: 20,
  screen: 20,
  battery: 25,
  box: 5,
  warranty: 10,
  registry: 10,
  base_new: 10,
  base_likenew: 8,
  base_used: 5,
  repair_screen: 10,
  repair_back_glass: 4,
  repair_battery: 5,
  repair_board: 25,
  repair_camera: 8,
  repair_faceid: 15,
  repair_frame: 3,
  repair_other: 4,
  repair_cap: 30
};
var REPAIR_PARTS = [
  ["screen", /(صفحه|ال ?سی ?دی|lcd|تاچ|نمایشگر|display)/],
  ["back_glass", /(شیشه پشت|درب پشت|پشت گوشی|back glass|گلس پشت)/],
  ["battery", /(باتری)/],
  ["board", /(برد|مادربرد|مین ?بورد|آی ?سی|ic)/],
  ["camera", /(دوربین|کمرا)/],
  ["faceid", /(فیس ?آیدی|face ?id|فیس ?اید)/],
  ["frame", /(قاب|فریم|بدنه)/]
];
function parseNums(s) {
  return (normFa(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);
}
function condClass(dc, text = "") {
  const n = normFa(dc || "");
  if (/نیازمند|تعمیر|خراب/.test(n)) return "broken";
  if (/در حد نو|درحدنو/.test(n)) return "likenew";
  if (/کارکرده|استوک|دست دوم/.test(n)) return "used";
  if (/(^| )نو( |$)|آکبند|پلمپ/.test(n)) return "new";
  const t = normFa(text);
  if (/پلمپ|آکبند/.test(t)) return "new";
  return null;
}
var GRADE_BODY = [
  [/بدون (خط|خدش)|بی خط|سالم|تمیز/, 1],
  [/خط و خش جزئی|خط جزئی|جزئی/, 0.75],
  [/خط و خش|خدشه/, 0.6],
  [/ضربه|لب پریدگی|لب پریده|فرورفتگی|خم/, 0.35],
  [/شکسته|خرد|ترک/, 0.1]
];
var GRADE_SCREEN = [
  [/سالم|بدون (خط|ترک|لک)|بی خط/, 1],
  [/خط جزئی|خط و خش جزئی|جزئی/, 0.75],
  [/خط|خش/, 0.6],
  [/لک|سایه|برن ?این|burn|پیکسل/, 0.45],
  [/ترک|شکسته|شکست/, 0.15]
];
function grade(text, table) {
  if (!text) return null;
  const n = normFa(text);
  for (const [re, g] of table) if (re.test(n)) return g;
  return null;
}
function extractFeatures(inp, weights = DEFAULT_WEIGHTS) {
  const text = normFa(`${inp.title ?? ""} ${inp.description ?? ""}`);
  const f = {
    cond_class: condClass(inp.device_condition, text),
    battery_pct: null,
    battery_src: null,
    battery_conflict: false,
    repairs: [],
    flags: [],
    warranty: null,
    registry: null,
    box: null,
    body_grade: null,
    screen_grade: null,
    score: 0,
    conf: 0
  };
  const fieldNums = inp.battery_health ? parseNums(inp.battery_health).filter((x) => x >= 40 && x <= 100) : [];
  if (fieldNums.length) {
    f.battery_pct = Math.round(fieldNums.reduce((a, b) => a + b, 0) / fieldNums.length);
    f.battery_src = "field";
  }
  const bm = text.match(/(?:باتری|سلامت باتری|battery|health)[^\d]{0,14}(\d{2,3})\s*(?:%|درصد)?/) || text.match(/(\d{2,3})\s*(?:%|درصد)\s*(?:باتری|سلامت|battery)/);
  if (bm) {
    const v = Number(bm[1]);
    if (v >= 40 && v <= 100) {
      if (f.battery_pct === null) {
        f.battery_pct = v;
        f.battery_src = "text";
      } else if (Math.abs(f.battery_pct - v) > 8) f.battery_conflict = true;
    }
  }
  const negAll = /(بدون تعمیر|تعمیر نشده|تعویض نشده|عوض نشده|دست نخورده|بدون تعویض|هیچ تعمیر)/.test(text);
  const rep = /* @__PURE__ */ new Set();
  const V = "(?:\u062A\u0639\u0648\u06CC\u0636|\u0639\u0648\u0636|\u062A\u0639\u0645\u06CC\u0631|\u062A\u0631\u0645\u06CC\u0645|\u0631\u0646\u06AF \u0634\u062F\u0647|\u0631\u0646\u06AF\u06CC \u0634\u062F\u0647)(?!\\s*(?:\u0646\u0634|\u0646\u0645\u06CC\u062E))";
  for (const [part, pr] of REPAIR_PARTS) {
    const src = pr.source;
    const A = new RegExp(`${V}\\s*(?:\u0634\u062F\u0647)?\\s*(?:\u06CC)?\\s*[^.\u060C\\n]{0,10}?(?:${src})`, "g");
    const B = new RegExp(`(?:${src})\\s*(?:\u0634|\u06CC)?\\s*(?:\u0631\u0648|\u0631\u0627)?\\s*${V}`, "g");
    for (const re of [A, B]) {
      let m;
      while (m = re.exec(text)) {
        const before = text.slice(Math.max(0, m.index - 8), m.index);
        if (/بدون/.test(before)) continue;
        rep.add(part);
      }
    }
  }
  if (!rep.size && !negAll && /(تعمیری|تعمیر شده|تعویضی)/.test(text)) rep.add("other");
  f.repairs = [...rep];
  const flag = (k, cond) => {
    if (cond && !f.flags.includes(k)) f.flags.push(k);
  };
  flag("icloud_locked", /(آیکلود|icloud)[^.]{0,12}(قفل|لاک|lock)|قفل (آیکلود|icloud)/.test(text) && !/بدون قفل/.test(text));
  flag("network_locked", /(قفل شبکه|سیم ?کارت لاک|network lock)/.test(text));
  flag("not_registered", /(رجیستر|رجیستری)\s*(نشده|نیست|ندار)|نیاز به رجیستر|بدون رجیستر/.test(text));
  flag("broken", /(خراب|شکسته|سوخته|مرده|روشن نمیشه|روشن نمی شه|نیازمند تعمیر)/.test(text) && !/(بدون خرابی|خراب نیست|خرابی ندار)/.test(text));
  flag("parts_only", /(برای قطعات|فقط قطعه|جهت قطعات|قطعه ای)/.test(text));
  flag("installment_price", /(اقساط|قسطی|اقساطی)/.test(text));
  flag("exchange_offer", /(معاوضه|مبادله|تهاتر)/.test(text));
  flag("negotiable_price", /(توافقی|تماس بگیرید|تماس بگیر|زنگ بزنید|بدون قیمت)/.test(text));
  if (f.cond_class === "broken") flag("broken", true);
  f.registry = f.flags.includes("not_registered") ? "no" : /(رجیستر\s*(شده|دار)|رجیستری فعال|رجیستر)/.test(text) ? "yes" : null;
  if (/(بدون گارانتی|گارانتی ندار)/.test(text)) f.warranty = "none";
  else if (/(گارانتی\s*(شرکتی|طلایی|اصلی|ایران|رسمی|آواژنگ|زیتل|ایرانیان)|\d+\s*ماه\s*گارانتی|گارانتی\s*\d+\s*ماه)/.test(text)) f.warranty = "company";
  const bx = normFa(inp.box_status || "");
  if (/کامل|با لوازم|همه/.test(bx) || /(کارتن|جعبه)[^.]{0,10}(کامل|لوازم)/.test(text)) f.box = "full";
  else if (/جعبه|کارتن/.test(bx) || /(کارتن|جعبه)/.test(text)) f.box = "box";
  else if (/بدون/.test(bx)) f.box = "none";
  f.body_grade = grade(inp.body_condition, GRADE_BODY) ?? (/(بدون خط و خش|بی خط و خش|بدون خط)/.test(text) ? 1 : null);
  f.screen_grade = grade(inp.screen_condition, GRADE_SCREEN);
  const sc = scoreFeatures(f, weights);
  f.score = sc.score;
  f.conf = sc.conf;
  return f;
}
function scoreFeatures(f, w = DEFAULT_WEIGHTS) {
  let known = 0;
  const total = 6;
  const body = f.body_grade ?? 0.6;
  if (f.body_grade !== null) known++;
  const screen = f.screen_grade ?? 0.7;
  if (f.screen_grade !== null) known++;
  const bat = f.battery_pct === null ? 0.6 : Math.max(0, Math.min(1, (f.battery_pct - 60) / 40));
  if (f.battery_pct !== null) known++;
  const box = f.box === "full" ? 1 : f.box === "box" ? 0.6 : f.box === "none" ? 0 : 0.4;
  if (f.box) known++;
  const war = f.warranty === "company" ? 1 : f.warranty === "none" ? 0 : 0.3;
  if (f.warranty) known++;
  const reg = f.registry === "yes" ? 1 : f.registry === "no" ? 0 : 0.5;
  if (f.registry) known++;
  let s = w.body * body + w.screen * screen + w.battery * bat + w.box * box + w.warranty * war + w.registry * reg;
  s += f.cond_class === "new" ? w.base_new : f.cond_class === "likenew" ? w.base_likenew : w.base_used;
  let pen = 0;
  const P = { screen: w.repair_screen, back_glass: w.repair_back_glass, battery: w.repair_battery, board: w.repair_board, camera: w.repair_camera, faceid: w.repair_faceid, frame: w.repair_frame, other: w.repair_other };
  for (const r of f.repairs) pen += P[r] ?? w.repair_other;
  s -= Math.min(pen, w.repair_cap);
  return { score: Math.max(0, Math.min(100, Math.round(s))), conf: Math.round(known / total * 100) / 100 };
}
function excludedReason(f) {
  for (const k of HARD_FLAGS) if (f.flags.includes(k)) return k;
  if (f.cond_class === "broken") return "broken";
  return null;
}

// src/core/stats.ts
function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function summarize(prices) {
  const xs = prices.filter((p) => isFinite(p) && p > 0);
  const n = xs.length;
  if (n === 0) return { n: 0, kept: 0, removed: 0, mean: null, median: null, min: null, max: null, method: "none" };
  let kept = xs;
  let method = "none";
  if (n >= 6) {
    const med = median(xs);
    const mad = median(xs.map((x) => Math.abs(x - med)));
    method = "mad";
    if (mad > 0) kept = xs.filter((x) => Math.abs(0.6745 * (x - med)) / mad <= 3.5);
    else kept = xs.filter((x) => Math.abs(x - med) / med <= 0.5);
  } else if (n >= 5) {
    const s = [...xs].sort((a, b) => a - b);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    method = "iqr";
    kept = xs.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  }
  if (!kept.length) kept = xs;
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  return { n, kept: kept.length, removed: n - kept.length, mean: Math.round(mean), median: Math.round(median(kept)), min: Math.min(...kept), max: Math.max(...kept), method };
}
var N_MIN = 5;
function pickLevel(levels, nMin = N_MIN) {
  for (const l of levels) {
    if (l.values.length >= nMin) return { level: l.level, summary: summarize(l.values), meta: l.meta };
  }
  return null;
}
function pctChange(prev, cur) {
  if (!prev || !cur) return null;
  return (cur - prev) / prev;
}

// src/core/pricing.ts
function roundTo(x, step) {
  return step > 0 ? Math.round(x / step) * step : Math.round(x);
}
function sellPrice(cost, marginPct, round = 1e4) {
  return roundTo(cost * (1 + marginPct / 100), round);
}
function breakdown(cost, marginPct, round = 1e4) {
  const price = sellPrice(cost, marginPct, round);
  return { cost, marginPct, profit: price - cost, price };
}

// src/core/time.ts
var TEHRAN_OFFSET_MIN = 210;
var MIN = 6e4;
var DAY_MS = 864e5;
var p2 = (n) => String(n).padStart(2, "0");
function tehranParts(ms) {
  const d = new Date(ms + TEHRAN_OFFSET_MIN * MIN);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
    ymd: `${year}-${p2(month)}-${p2(day)}`,
    hhmm: `${p2(hour)}:${p2(minute)}`
  };
}
function tehranDay(ms) {
  return tehranParts(ms).ymd;
}
function utcDay(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
function parseHHMM(s) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}
function minutesOfDay(hhmm) {
  const x = parseHHMM(hhmm);
  return x ? x.h * 60 + x.m : null;
}
function tehranToMs(ymd, hhmm = "00:00") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const t = parseHHMM(hhmm);
  if (!m || !t) throw new Error(`\u062A\u0627\u0631\u06CC\u062E/\u0633\u0627\u0639\u062A \u0646\u0627\u0645\u0639\u062A\u0628\u0631: ${ymd} ${hhmm}`);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t.h, t.m, 0, 0);
  return utc - TEHRAN_OFFSET_MIN * MIN;
}
function addDaysYmd(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`\u062A\u0627\u0631\u06CC\u062E \u0646\u0627\u0645\u0639\u062A\u0628\u0631: ${ymd}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
function tehranStartOfDay(ms) {
  return tehranToMs(tehranDay(ms), "00:00");
}
var G_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function gregorianToJalali(gy0, gm, gd) {
  let gy = gy0;
  let jy;
  if (gy > 1600) {
    jy = 979;
    gy -= 1600;
  } else {
    jy = 0;
    gy -= 621;
  }
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + G_DAYS_BEFORE_MONTH[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}
var JALALI_MONTHS = [
  "\u0641\u0631\u0648\u0631\u062F\u06CC\u0646",
  "\u0627\u0631\u062F\u06CC\u0628\u0647\u0634\u062A",
  "\u062E\u0631\u062F\u0627\u062F",
  "\u062A\u06CC\u0631",
  "\u0645\u0631\u062F\u0627\u062F",
  "\u0634\u0647\u0631\u06CC\u0648\u0631",
  "\u0645\u0647\u0631",
  "\u0622\u0628\u0627\u0646",
  "\u0622\u0630\u0631",
  "\u062F\u06CC",
  "\u0628\u0647\u0645\u0646",
  "\u0627\u0633\u0641\u0646\u062F"
];
var WEEKDAYS_FA = ["\u06CC\u06A9\u0634\u0646\u0628\u0647", "\u062F\u0648\u0634\u0646\u0628\u0647", "\u0633\u0647\u200C\u0634\u0646\u0628\u0647", "\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647", "\u067E\u0646\u062C\u0634\u0646\u0628\u0647", "\u062C\u0645\u0639\u0647", "\u0634\u0646\u0628\u0647"];
var toFa = (s) => s.replace(/[0-9]/g, (d) => "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9"[Number(d)]);
function fmtJalaliDate(ms) {
  const t = tehranParts(ms);
  const j = gregorianToJalali(t.year, t.month, t.day);
  return toFa(`${j.jy}/${p2(j.jm)}/${p2(j.jd)}`);
}
function fmtJalaliLong(ms) {
  const t = tehranParts(ms);
  const j = gregorianToJalali(t.year, t.month, t.day);
  return toFa(`${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`);
}
function fmtJalaliDateTime(ms) {
  return `${fmtJalaliDate(ms)} ${toFa(tehranParts(ms).hhmm)}`;
}
function fmtHHMM(ms) {
  return toFa(tehranParts(ms).hhmm);
}
function fmtAgo(thenMs, nowMs) {
  if (!thenMs) return "\u0647\u0631\u06AF\u0632";
  const diff = nowMs - thenMs;
  if (diff < 0) return "\u0647\u0645\u06CC\u0646 \u062D\u0627\u0644\u0627";
  const m = Math.floor(diff / MIN);
  if (m < 1) return "\u0647\u0645\u06CC\u0646 \u062D\u0627\u0644\u0627";
  if (m < 60) return `${toFa(String(m))} \u062F\u0642\u06CC\u0642\u0647 \u067E\u06CC\u0634`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${toFa(String(h))} \u0633\u0627\u0639\u062A \u067E\u06CC\u0634`;
  const d = Math.floor(h / 24);
  return `${toFa(String(d))} \u0631\u0648\u0632 \u067E\u06CC\u0634`;
}
function fmtDuration(ms) {
  const a = Math.abs(ms);
  const m = Math.round(a / MIN);
  if (m < 1) return "\u06A9\u0645\u062A\u0631 \u0627\u0632 \u06CC\u06A9 \u062F\u0642\u06CC\u0642\u0647";
  if (m < 60) return `${toFa(String(m))} \u062F\u0642\u06CC\u0642\u0647`;
  const h = Math.round(m / 60);
  if (h < 48) return `${toFa(String(h))} \u0633\u0627\u0639\u062A`;
  return `${toFa(String(Math.round(h / 24)))} \u0631\u0648\u0632`;
}
export {
  AUTO_THRESHOLD,
  BRANDS,
  COLORS,
  DEFAULT_WEIGHTS,
  FA2EN,
  FA2EN_BIGRAM,
  FA2EN_SPLIT,
  HARD_FLAGS,
  JALALI_MONTHS,
  MID_THRESHOLD,
  NOISE,
  N_MIN,
  SERIES_BRAND,
  TEHRAN_OFFSET_MIN,
  TIER,
  WEEKDAYS_FA,
  addDaysYmd,
  breakdown,
  candidateTokenSet,
  canonTokens,
  condClass,
  excludedReason,
  extractFeatures,
  fmtAgo,
  fmtDuration,
  fmtHHMM,
  fmtJalaliDate,
  fmtJalaliDateTime,
  fmtJalaliLong,
  fmtNum,
  fmtToman,
  gregorianToJalali,
  inferBrand,
  matchText,
  median,
  minutesOfDay,
  modelIdFrom,
  nameTokens,
  normFa,
  parseBudget,
  parseHHMM,
  parseQuery,
  parseVariantKey,
  pctChange,
  pickLevel,
  rank,
  roundTo,
  scoreCandidate,
  scoreFeatures,
  sellPrice,
  sha1Hex,
  slug,
  splitMessage,
  summarize,
  tehranDay,
  tehranParts,
  tehranStartOfDay,
  tehranToMs,
  toAsciiDigits,
  toFaDigits,
  tokenize,
  utcDay,
  variantKey
};
