ALTER TABLE service_state ADD COLUMN probe_detail TEXT;
ALTER TABLE outages ADD COLUMN probe_detail TEXT;

CREATE TABLE incident_annotations (
  incident_id INTEGER PRIMARY KEY REFERENCES outages(id),
  cause_code TEXT NOT NULL CHECK (cause_code IN (
    'server_restart', 'power_failure', 'network_failure', 'monitoring_error', 'unknown'
  )),
  public_summary TEXT NOT NULL CHECK (length(public_summary) <= 240),
  evidence_ref TEXT,
  annotated_at INTEGER NOT NULL
);
