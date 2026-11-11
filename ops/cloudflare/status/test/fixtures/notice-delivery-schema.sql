-- Proposed source only. No serving path applies or uses this migration.
CREATE TABLE notice_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation BETWEEN 0 AND 9007199254740991),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  next_allowed_at INTEGER NOT NULL DEFAULT 0,
  state_json TEXT CHECK (state_json IS NULL OR length(state_json) <= 1048576)
);
INSERT INTO notice_control (id, schema_version) VALUES (1, 1);

CREATE TABLE notice_delivery (
  notice_key TEXT PRIMARY KEY CHECK (length(notice_key) BETWEEN 1 AND 256),
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 4096),
  state TEXT NOT NULL CHECK (state IN ('ready', 'sending', 'acknowledged', 'uncertain')),
  attempt_generation INTEGER,
  not_before INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000),
  outcome TEXT CHECK (outcome IN ('accepted', 'not_accepted', 'rate_limited', 'unknown')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX notice_delivery_state ON notice_delivery (state, notice_key);
CREATE TRIGGER notice_delivery_capacity BEFORE INSERT ON notice_delivery
WHEN NOT EXISTS (SELECT 1 FROM notice_delivery WHERE notice_key = NEW.notice_key)
  AND (SELECT count(*) FROM notice_delivery) >= 2000
BEGIN SELECT RAISE(ABORT, 'Notice delivery capacity reached'); END;
