-- Grounded AI explanations: cached by evidence + prompt version; provenance kept for audit.
CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  source TEXT NOT NULL,            -- ai | template_fallback
  model TEXT,
  prompt_version TEXT NOT NULL,
  output TEXT NOT NULL,            -- validated JSON shown to the user
  validation TEXT NOT NULL,        -- JSON list of failed checks (empty when accepted)
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  who TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
