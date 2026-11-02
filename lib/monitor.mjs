import { acquireLease, commitCheck, releaseLease } from './store.mjs';

const PRIMARY = 'https://stellaratlas.io/__failover/status';
const DATA = 'https://api.stellaratlas.io/v1/public-goods/health';
const FALLBACK = 'https://stellaratlas-core-fallback.s3x.workers.dev/api/snapshot/meta?explorer=1';

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing health response');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new Error('Invalid health response'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function dataReadiness(body, now) {
  const timestamp = Date.parse(body?.generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5_000)
    return { ok: false, reasonCode: 'data_unavailable', probeDetail: { kind: 'response', status: 'invalid' } };
  if (now - timestamp >= 300_000)
    return { ok: false, reasonCode: 'data_stale', probeDetail: { kind: 'response', status: 'stale', ageSeconds: Math.min(864000, Math.floor((now - timestamp) / 1000)) } };
  // This component measures the data service, not archive-verification freshness.
  for (const check of ['clickhouse', 'publication']) {
    const reported = body?.checks?.[check]?.status;
    if (reported === 'ready') continue;
    const status = ['stale', 'unavailable', 'empty', 'incomplete'].includes(reported) ? reported : 'invalid';
    const detail = { kind: 'readiness', check, status };
    const observed = Date.parse(check === 'publication' && status === 'stale'
      ? body?.checks?.[check]?.latestCompletedAt ?? body?.checks?.[check]?.observedAt : body?.checks?.[check]?.observedAt);
    if (Number.isFinite(observed) && observed <= now) detail.ageSeconds = Math.min(864000, Math.floor((now - observed) / 1000));
    return { ok: false, reasonCode: status === 'stale' ? 'data_stale' : 'data_unavailable', probeDetail: detail };
  }
  return { ok: true, reasonCode: 'ok', probeDetail: null };
}

async function probe(url, mode, fetchImpl, clock) {
  let firstFailure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url, { method: 'GET',
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        redirect: 'manual', signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 0 } });
      let result = { ok: false, probeDetail: { kind: 'http', httpStatus: response.status } };
      // A composite 503 can still report healthy data checks and an unrelated
      // archive-summary issue. Inspect the bounded structured response first.
      if (response.ok || mode === 'data' && response.status === 503) {
        let body;
        try { body = await readJson(response); }
        catch (error) { result = { ok: false, probeDetail: ['TimeoutError', 'AbortError'].includes(error?.name)
          ? { kind: 'timeout' } : { kind: 'response', status: 'invalid', httpStatus: response.status } }; }
        if (body) {
          if (mode === 'data') {
            result = dataReadiness(body, clock());
            if (!result.ok && !response.ok) result.probeDetail.httpStatus = response.status;
          }
          else if (mode === 'primary') result = body.available === true
            ? { ok: true } : { ok: false, probeDetail: { kind: 'readiness', status: 'unavailable' } };
          else result = Number.isSafeInteger(body.knownNodes) && body.knownNodes > 0
            && Number.isSafeInteger(body.archiveRoots) && body.archiveRoots > 0 && body.explorer?.available === true
            ? { ok: true } : { ok: false, probeDetail: { kind: 'readiness', status: 'incomplete' } };
        }
      } else await response.body?.cancel();
      const observedAt = clock();
      if (result.ok) return { ...result, observedAt };
      firstFailure ??= { ...result, observedAt };
      console.warn(JSON.stringify({event:'status-probe-rejected',component:mode,...result.probeDetail}));
    } catch (error) {
      const failed = { ok: false, observedAt: clock(), probeDetail: { kind: ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'unavailable' } };
      firstFailure ??= failed;
      console.warn(JSON.stringify({event:'status-probe-error',component:mode,...failed.probeDetail}));
    }
  }
  return firstFailure;
}

async function pointer(bucket, key, clock) {
  let capturedAt = null;
  try {
    const object = await bucket.get(key);
    if (!object || object.size > 65_536) await object?.body?.cancel();
    else {
      const value = await object.json();
      capturedAt = typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt))
        ? new Date(value.capturedAt).toISOString() : null;
    }
  } catch { /* Retain an unknown snapshot, never a fabricated success. */ }
  return { capturedAt, observedAt: clock() };
}

export async function runCheck(env, { clock = Date.now, fetchImpl = fetch } = {}) {
  const now = clock();
  const token = crypto.randomUUID();
  if (!await acquireLease(env.DB, now, token)) return { checked: false, reason: 'in_progress' };
  try {
    const [primary, data, fallback, core, explorer] = await Promise.all([
      probe(PRIMARY, 'primary', fetchImpl, clock), probe(DATA, 'data', fetchImpl, clock), probe(FALLBACK, 'fallback', fetchImpl, clock),
      pointer(env.MIRROR, 'core-mirror/current.json', clock), pointer(env.MIRROR, 'core-mirror/explorer/current.json', clock)
    ]);
    const coreAt = core.capturedAt, explorerAt = explorer.capturedAt;
    const savedAt = coreAt && explorerAt ? [coreAt, explorerAt].sort()[0] : null;
    const savedReady = fallback.ok && coreAt !== null && explorerAt !== null;
    const failedSavedObservations = [
      ...(!fallback.ok ? [{at:fallback.observedAt, detail:fallback.probeDetail}] : []),
      ...[core,explorer].filter(item => item.capturedAt === null)
        .map(item => ({at:item.observedAt, detail:{kind:'readiness',status:'incomplete'}}))
    ].sort((a,b) => a.at-b.at);
    const observations = [
      { id: 'primary', state: primary.ok ? 'operational' : 'degraded',
        reasonCode: primary.ok ? 'ok' : 'origin_unavailable', snapshotAt: coreAt,
        observedAt: primary.observedAt, probeDetail: primary.probeDetail },
      { id: 'data', state: data.ok ? 'operational' : primary.ok ? 'degraded' : 'unknown',
        reasonCode: data.ok ? 'ok' : primary.ok ? data.reasonCode ?? 'data_unavailable' : 'monitor_unavailable', snapshotAt: explorerAt,
        observedAt: data.observedAt, probeDetail: data.probeDetail },
      { id: 'failover', state: savedReady ? 'operational' : 'degraded',
        reasonCode: savedReady ? 'standby' : 'snapshot_unavailable', snapshotAt: savedAt,
        observedAt: savedReady ? Math.max(fallback.observedAt,core.observedAt,explorer.observedAt) : failedSavedObservations[0].at,
        probeDetail: savedReady ? null : failedSavedObservations[0].detail }
    ];
    const committed = await commitCheck(env.DB, observations, clock(), token);
    return { checked: committed };
  } finally { await releaseLease(env.DB, token).catch(() => {}); }
}

export async function authorized(request, expected) {
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const supplied = request.headers.get('authorization') ?? '';
  const bytes = new TextEncoder();
  const [a, b] = await Promise.all([supplied, 'Bearer ' + expected].map(value =>
    crypto.subtle.digest('SHA-256', bytes.encode(value))));
  return new Uint8Array(a).reduce((different, value, index) => different | value ^ new Uint8Array(b)[index], 0) === 0;
}
