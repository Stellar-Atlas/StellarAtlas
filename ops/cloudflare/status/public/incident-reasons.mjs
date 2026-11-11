import { duration } from './history.mjs';
const checks = { clickhouse: 'Data availability', publication: 'Publication', archive: 'Archive freshness' };
export const causes = { server_restart: 'Server restart', power_failure: 'Power interruption',
  network_failure: 'Network interruption', monitoring_error: 'Monitoring error', unknown: 'Cause not confirmed' };
export function reportedReason(item) {
  const detail = item.probeDetail;
  if (detail?.kind === 'http') return `Readiness request returned HTTP ${detail.httpStatus}.`;
  if (detail?.kind === 'timeout') return 'Readiness request timed out after 10s.';
  if (detail?.kind === 'response') return detail.status === 'stale'
    ? `Health observation was ${duration((detail.ageSeconds ?? 0) * 1000)} old.` : 'Health response was not valid.';
  if (detail?.kind === 'readiness') return `${checks[detail.check] ?? 'Readiness'} check reported ${detail.status ?? 'unavailable'}.`
    + (detail.ageSeconds === undefined ? '' : ` ${detail.check === 'publication' && detail.status === 'stale' ? 'Last publication' : 'Observation'} ${duration(detail.ageSeconds * 1000)} old.`);
  if (detail?.kind === 'unavailable') return 'Readiness request could not be completed.';
  return ({ origin_unavailable: 'Primary readiness check reported unavailable.', data_unavailable: 'Data readiness check reported unavailable.',
    data_stale: 'Data freshness check reported stale.', snapshot_unavailable: 'Failover readiness check reported unavailable.',
    monitor_unavailable: 'Readiness check unavailable.' })[item.reasonCode] ?? 'Recorded interruption; cause not confirmed.';
}
