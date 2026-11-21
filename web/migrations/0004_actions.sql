-- Action lifecycle: current status + append-only history. Execution state only; outcomes stay in the follow-up.
CREATE TABLE IF NOT EXISTS actions (
  issue_id TEXT PRIMARY KEY,
  replay_date TEXT NOT NULL,
  owner_kind TEXT NOT NULL,          -- 'sp' (salesperson issue) or 'am' (store issue)
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- new | accepted | blocked | attempted | reviewed | dismissed
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS action_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_action_events_issue ON action_events(issue_id, id);
CREATE INDEX IF NOT EXISTS idx_actions_owner ON actions(owner_id);
