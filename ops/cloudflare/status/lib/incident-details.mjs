const KINDS = new Set(['http', 'timeout', 'response', 'readiness', 'unavailable']);
const CHECKS = new Set(['clickhouse', 'publication', 'archive']);
const STATUSES = new Set(['ready', 'stale', 'unavailable', 'empty', 'incomplete', 'invalid']);
const FIELDS = new Set(['kind', 'httpStatus', 'check', 'status', 'ageSeconds']);
const CAUSES = new Set(['server_restart', 'power_failure', 'network_failure', 'monitoring_error', 'unknown']);

export function safeProbeDetail(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).some(key => !FIELDS.has(key)) || !KINDS.has(value.kind)) {
    throw new TypeError('Invalid probe detail');
  }
  const detail = { kind: value.kind };
  if (Object.hasOwn(value, 'httpStatus')) {
    if (!Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599) {
      throw new TypeError('Invalid probe HTTP status');
    }
    detail.httpStatus = value.httpStatus;
  }
  if (Object.hasOwn(value, 'check')) {
    if (!CHECKS.has(value.check)) throw new TypeError('Invalid probe check');
    detail.check = value.check;
  }
  if (Object.hasOwn(value, 'status')) {
    if (!STATUSES.has(value.status)) throw new TypeError('Invalid probe status');
    detail.status = value.status;
  }
  if (Object.hasOwn(value, 'ageSeconds')) {
    if (!Number.isInteger(value.ageSeconds) || value.ageSeconds < 0 || value.ageSeconds > 864000) {
      throw new TypeError('Invalid probe age');
    }
    detail.ageSeconds = value.ageSeconds;
  }
  return detail;
}

export function readProbeDetail(value) {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value !== 'string' || value.length > 512) return null;
    return safeProbeDetail(JSON.parse(value));
  } catch { return null; }
}

export function incidentAnnotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).some(key => !['incidentId', 'causeCode', 'publicSummary', 'evidenceRef'].includes(key))
      || !Number.isSafeInteger(value.incidentId) || value.incidentId < 1 || !CAUSES.has(value.causeCode)) {
    throw new TypeError('Invalid incident annotation');
  }
  const summary = value.publicSummary;
  if (typeof summary !== 'string' || !summary.trim() || [...summary].length > 240
      || /[\u0000-\u001f\u007f]/u.test(summary)) throw new TypeError('Invalid public incident summary');
  const evidence = value.evidenceRef ?? null;
  if (evidence !== null && (typeof evidence !== 'string' || !evidence.trim()
      || evidence.length > 1024 || /[\u0000-\u001f\u007f]/u.test(evidence))) {
    throw new TypeError('Invalid private evidence reference');
  }
  return { incidentId: value.incidentId, causeCode: value.causeCode, publicSummary: summary, evidenceRef: evidence };
}

export function readIncidentCause(row) {
  if (!CAUSES.has(row.cause_code) || !Number.isSafeInteger(row.annotated_at) || row.annotated_at < 0) return null;
  try {
    const cause = incidentAnnotation({ incidentId: row.id, causeCode: row.cause_code, publicSummary: row.public_summary });
    return { code: cause.causeCode, summary: cause.publicSummary, annotatedAt: row.annotated_at };
  } catch { return null; }
}
