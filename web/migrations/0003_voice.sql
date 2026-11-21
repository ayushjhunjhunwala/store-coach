CREATE TABLE IF NOT EXISTS voice_cache (
  key TEXT PRIMARY KEY,
  lang TEXT NOT NULL,
  caption TEXT NOT NULL,
  codec TEXT NOT NULL,
  audio_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS voice_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  cached INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
