-- نمونه‌ی ساختار جدول‌هایی که این ریپو می‌خواند/می‌نویسد؛ فقط برای تست‌ها.
-- از advisor-worker/schema.sql استخراج شده است. هر تغییر آن‌جا باید اینجا هم بیاید (تست هم‌خوانی سمت Worker این را چک می‌کند).

CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  token TEXT PRIMARY KEY, title TEXT, category TEXT, link TEXT, status TEXT, device_condition TEXT, brand_model TEXT,
  internal_storage REAL, ram REAL, color TEXT, price REAL, price_note TEXT, sim_count TEXT, originality TEXT,
  manufacturer TEXT, screen_size REAL, os TEXT, connection_type TEXT, camera_condition TEXT, screen_condition TEXT,
  body_condition TEXT, box_status TEXT, battery_health TEXT, ownership_transfer TEXT, adapter TEXT, charging_cable TEXT,
  location TEXT, neighborhood TEXT, district_slug TEXT, city TEXT, latitude REAL, longitude REAL, seller_type TEXT,
  business_type TEXT, image_count REAL, description TEXT, all_specs_json TEXT,
  is_broadcasted INTEGER DEFAULT 0, broadcast_attempts INTEGER DEFAULT 0, delivered_to TEXT,
  specs_text TEXT, first_seen TEXT, last_seen TEXT, edit_count REAL
);
CREATE INDEX IF NOT EXISTS idx_category_lastseen ON listings(category, last_seen);
CREATE INDEX IF NOT EXISTS idx_last_seen ON listings(last_seen);
CREATE INDEX IF NOT EXISTS idx_first_seen ON listings(first_seen);
CREATE TABLE IF NOT EXISTS listing_state (
  token TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1, checked_at INTEGER, closed_reason TEXT, last_price REAL
);
CREATE TABLE IF NOT EXISTS listing_features (
  token TEXT PRIMARY KEY,
  model_id TEXT, variant_key TEXT,
  storage_gb INTEGER NOT NULL DEFAULT 0, ram_gb INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '',
  cond_class TEXT,
  battery_pct INTEGER, flags TEXT, repairs TEXT, score INTEGER, conf REAL,
  match_score REAL, match_method TEXT, excluded TEXT, desc_hash TEXT, features_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lf_model ON listing_features(model_id, cond_class);
CREATE TABLE IF NOT EXISTS device_catalog (
  model_id TEXT PRIMARY KEY,
  brand TEXT NOT NULL, name TEXT NOT NULL, name_norm TEXT NOT NULL, alias_tokens TEXT,
  type TEXT NOT NULL DEFAULT 'phone',      -- phone | tablet
  year INTEGER, storages TEXT, rams TEXT, colors TEXT, specs TEXT,
  source TEXT NOT NULL DEFAULT 'observed', -- observed | manual | external
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS model_tokens (
  token TEXT NOT NULL, model_id TEXT NOT NULL, PRIMARY KEY (token, model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_tokens_model ON model_tokens(model_id);
CREATE TABLE IF NOT EXISTS match_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, ref TEXT, input_norm TEXT, model_id TEXT, score REAL, method TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS unmatched_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, ref TEXT, text TEXT NOT NULL, text_norm TEXT,
  candidates TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unmatched_status ON unmatched_queue(status, created_at);
CREATE TABLE IF NOT EXISTS market_price_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                  -- تاریخ میلادی به وقت تهران
  model_id TEXT NOT NULL,
  storage_gb INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '',
  cond_class TEXT NOT NULL,           -- new | likenew | used
  segment TEXT NOT NULL DEFAULT 'all',
  level INTEGER NOT NULL, n INTEGER NOT NULL, n_removed INTEGER NOT NULL DEFAULT 0,
  mean REAL, median REAL, min REAL, max REAL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | manual | auto | rejected
  prev_mean REAL, flagged INTEGER NOT NULL DEFAULT 0, note TEXT,
  decided_by TEXT, decided_at INTEGER,
  UNIQUE (day, model_id, storage_gb, color, cond_class, segment)
);
CREATE INDEX IF NOT EXISTS idx_mpd_status ON market_price_daily(status, day);
CREATE INDEX IF NOT EXISTS idx_mpd_model ON market_price_daily(model_id, cond_class, day);
CREATE TABLE IF NOT EXISTS tech_news_raw (
  url TEXT PRIMARY KEY, title TEXT, summary TEXT, published TEXT, fetched_at INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0
);
