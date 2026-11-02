CREATE TABLE IF NOT EXISTS monitor_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at INTEGER,
  checked_at INTEGER,
  lease_until INTEGER,
  lease_token TEXT
);
INSERT OR IGNORE INTO monitor_control (id) VALUES (1);

CREATE TABLE IF NOT EXISTS service_state (
  id TEXT PRIMARY KEY CHECK (id IN ('primary', 'data', 'failover')),
  state TEXT NOT NULL CHECK (state IN ('operational', 'degraded', 'unknown')),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'ok', 'origin_unavailable', 'data_unavailable', 'data_stale',
    'monitor_unavailable', 'snapshot_unavailable', 'standby'
  )),
  checked_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  snapshot_at TEXT
);

CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY,
  component TEXT NOT NULL CHECK (component IN ('primary', 'data', 'failover')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'ok', 'origin_unavailable', 'data_unavailable', 'data_stale',
    'monitor_unavailable', 'snapshot_unavailable', 'standby'
  )),
  source TEXT NOT NULL DEFAULT 'monitor',
  confidence TEXT NOT NULL DEFAULT 'confirmed',
  evidence_key TEXT UNIQUE,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS outages_one_open_monitor
  ON outages (component) WHERE ended_at IS NULL AND source = 'monitor';
CREATE INDEX IF NOT EXISTS outages_history ON outages (started_at DESC, id DESC);
