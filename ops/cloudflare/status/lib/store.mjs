import { safeProbeDetail, readProbeDetail, incidentAnnotation, readIncidentCause } from './incident-details.mjs';

const IDS = ['primary', 'data', 'failover'];
const STATES = new Set(['operational', 'degraded', 'unknown']);
const REASONS = new Set([
  'ok', 'origin_unavailable', 'data_unavailable', 'data_stale',
  'monitor_unavailable', 'snapshot_unavailable', 'standby',
]);
const DAY_MS = 86400000;
const LEASE_GUARD = `EXISTS (
  SELECT 1 FROM monitor_control
  WHERE id = 1 AND lease_token = ? AND lease_until > ?
)`;

function instant(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid timestamp');
  return value;
}

function snapshot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError('Invalid snapshot timestamp');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('Invalid snapshot timestamp');
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction) =>
    `.${(fraction ?? '').padEnd(3, '0')}Z`);
  if (parsed.toISOString() !== normalized) throw new TypeError('Invalid snapshot timestamp');
  return parsed.toISOString();
}

function leaseToken(token) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 256) {
    throw new TypeError('Invalid lease token');
  }
}

function observationsForCheck(observations, now) {
  if (!Array.isArray(observations) || observations.length !== IDS.length) {
    throw new TypeError('Exactly three observations required');
  }
  const byId = new Map();
  for (const observation of observations) {
    if (!observation || !IDS.includes(observation.id) || byId.has(observation.id)
        || !STATES.has(observation.state) || !REASONS.has(observation.reasonCode)) {
      throw new TypeError('Invalid observation');
    }
    const observedAt = observation.observedAt === undefined ? now : instant(observation.observedAt);
    if (observedAt < Math.max(0, now - 90000) || observedAt > now) {
      throw new TypeError('Observation timestamp outside check window');
    }
    const detail = safeProbeDetail(observation.probeDetail);
    byId.set(observation.id, {
      id: observation.id, state: observation.state, reasonCode: observation.reasonCode,
      snapshotAt: snapshot(observation.snapshotAt),
      observedAt, probeDetail: detail === null ? null : JSON.stringify(detail),
    });
  }
  return IDS.map(id => byId.get(id));
}

function changed(result) {
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function acquireLease(db, now, token, leaseMs = 90000) {
  leaseToken(token);
  const at = instant(now);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 3600000) {
    throw new TypeError('Invalid lease duration');
  }
  const until = instant(at + leaseMs);
  const result = await db.prepare(`UPDATE monitor_control
    SET started_at = COALESCE(started_at, ?), lease_until = ?, lease_token = ?
    WHERE id = 1 AND (lease_until IS NULL OR lease_until <= ?)`)
    .bind(at, until, token, at).run();
  return changed(result);
}

export async function commitCheck(db, observations, now, token) {
  leaseToken(token);
  const at = instant(now);
  const checked = observationsForCheck(observations, at);
  const statements = [];
  for (const observation of checked) {
    const { id, state, reasonCode, snapshotAt, observedAt, probeDetail } = observation;
    if (state === 'degraded') {
      statements.push(db.prepare(`INSERT INTO outages
        (component, started_at, reason_code, probe_detail)
        SELECT ?, ?, ?, ? WHERE ${LEASE_GUARD}
        AND NOT EXISTS (SELECT 1 FROM outages
          WHERE component = ? AND source = 'monitor' AND ended_at IS NULL)`)
        .bind(id, observedAt, reasonCode, probeDetail, token, at, id));
    } else if (state === 'operational') {
      statements.push(db.prepare(`UPDATE outages SET ended_at = ?
        WHERE component = ? AND source = 'monitor' AND ended_at IS NULL
        AND ${LEASE_GUARD}`).bind(observedAt, id, token, at));
    }
    statements.push(db.prepare(`INSERT INTO service_state
      (id, state, reason_code, checked_at, changed_at, snapshot_at, probe_detail)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${LEASE_GUARD}
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state, reason_code = excluded.reason_code,
        checked_at = excluded.checked_at, snapshot_at = excluded.snapshot_at,
        probe_detail = excluded.probe_detail,
        changed_at = CASE WHEN service_state.state <> excluded.state
          THEN excluded.changed_at ELSE service_state.changed_at END`)
      .bind(id, state, reasonCode, observedAt, observedAt, snapshotAt, probeDetail, token, at));
  }
  // D1 batch is transactional; keep the ownership guard valid until all writes finish.
  statements.push(db.prepare(`UPDATE monitor_control
    SET checked_at = ?, lease_until = NULL, lease_token = NULL
    WHERE id = 1 AND ${LEASE_GUARD}`).bind(at, token, at));
  const results = await db.batch(statements);
  return changed(results[results.length - 1]);
}

export async function releaseLease(db, token) {
  leaseToken(token);
  const result = await db.prepare(`UPDATE monitor_control
    SET lease_until = NULL, lease_token = NULL
    WHERE id = 1 AND lease_token = ?`).bind(token).run();
  return changed(result);
}

// Internal reviewed-evidence entry point only; no public HTTP write route.
export async function annotateIncident(db, value, annotatedAt) {
  const { incidentId, causeCode, publicSummary, evidenceRef } = incidentAnnotation(value);
  const at = instant(annotatedAt);
  const result = await db.prepare(`INSERT INTO incident_annotations
    (incident_id, cause_code, public_summary, evidence_ref, annotated_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM outages WHERE id = ?)
    ON CONFLICT(incident_id) DO UPDATE SET
      cause_code = excluded.cause_code, public_summary = excluded.public_summary,
      evidence_ref = excluded.evidence_ref, annotated_at = excluded.annotated_at`)
    .bind(incidentId, causeCode, publicSummary, evidenceRef, at, incidentId).run();
  return changed(result);
}

export async function readStatus(db, now) {
  const at = instant(now);
  const cutoff = Math.max(0, at - 90 * DAY_MS);
  const results = await db.batch([
    db.prepare('SELECT started_at, checked_at FROM monitor_control WHERE id = 1'),
    db.prepare(`SELECT id, state, reason_code, checked_at, changed_at, snapshot_at, probe_detail
      FROM service_state WHERE id IN ('primary', 'data', 'failover')`),
    db.prepare(`SELECT o.id, o.component, o.started_at, o.ended_at, o.reason_code,
      o.source, o.confidence, o.probe_detail, a.cause_code, a.public_summary, a.annotated_at
      FROM outages o LEFT JOIN incident_annotations a ON a.incident_id = o.id
      WHERE o.source IN ('monitor', 'cloudflare-inferred')
      AND (o.ended_at IS NULL OR o.ended_at >= ?)
      ORDER BY (o.ended_at IS NULL) DESC, o.started_at DESC, o.id DESC LIMIT 1001`).bind(cutoff),
  ]);
  const control = results[0]?.results?.[0];
  const rows = new Map((results[1]?.results ?? []).map(row => [row.id, row]));
  const history = results[2]?.results ?? [];
  return {
    monitoringSince: control?.started_at ?? null,
    lastCheckedAt: control?.checked_at ?? null,
    historyComplete: history.length <= 1000,
    components: IDS.map(id => {
      const row = rows.get(id);
      return {
        id,
        state: STATES.has(row?.state) ? row.state : 'unknown',
        reasonCode: REASONS.has(row?.reason_code) ? row.reason_code : 'monitor_unavailable',
        checkedAt: row?.checked_at ?? null,
        changedAt: row?.changed_at ?? null,
        snapshotAt: row?.snapshot_at ?? null,
        probeDetail: readProbeDetail(row?.probe_detail),
      };
    }),
    recentIncidents: history.slice(0, 1000)
      .filter(row => IDS.includes(row.component) && REASONS.has(row.reason_code))
      .map(row => ({
        id: row.id, component: row.component,
        startedAt: row.started_at, endedAt: row.ended_at,
        reasonCode: row.reason_code,
        source: row.source === 'monitor' ? 'monitor' : 'historical',
        confidence: row.confidence === 'confirmed' ? 'confirmed' : 'inferred',
        probeDetail: readProbeDetail(row.probe_detail), cause: readIncidentCause(row),
      })),
  };
}
