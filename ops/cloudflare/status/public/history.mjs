export const ranges = [
  { id: '1h', label: '1 hour', ms: 3600000, slots: 60 },
  { id: '24h', label: '24 hours', ms: 86400000, slots: 96 },
  { id: '7d', label: '7 days', ms: 7 * 86400000, slots: 84 },
  { id: '30d', label: '30 days', ms: 30 * 86400000, slots: 90 },
  { id: '90d', label: '90 days', ms: 90 * 86400000, slots: 90 },
];

// Split only at actual observation boundaries; a one-minute interruption must
// not turn the rest of its hour or day into downtime.
export function segmentsFor(data, component, start, end, now = Date.now()) {
  const monitoredFrom = data.monitoringSince ?? end;
  const monitoredUntil = Math.min(now, (data.lastCheckedAt ?? 0) + 180000);
  const incidents = data.recentIncidents.filter(item => item.component === component
    && item.startedAt < end && (item.endedAt ?? now) > start);
  const cuts = new Set([start, end]);
  for (const point of [monitoredFrom, monitoredUntil, ...incidents.flatMap(item => [item.startedAt, item.endedAt ?? now])]) {
    if (point > start && point < end) cuts.add(point);
  }
  const boundaries = [...cuts].sort((a, b) => a - b), segments = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const from = boundaries[index], to = boundaries[index + 1];
    const interrupted = incidents.some(item => item.startedAt < to && (item.endedAt ?? now) > from);
    const state = interrupted ? 'degraded' : data.historyComplete !== false && from >= monitoredFrom && to <= monitoredUntil ? 'operational' : 'unknown';
    const previous = segments.at(-1);
    if (previous?.state === state) previous.end = to;
    else segments.push({ start: from, end: to, state });
  }
  return segments;
}

export function duration(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const seconds = total % 60, minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600) % 24, days = Math.floor(total / 86400);
  if (days) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (total >= 3600) return `${hours}h ${minutes}m ${seconds}s`;
  if (total >= 60) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function gradient(segments, start, end) {
  const colors = { operational: 'var(--green)', degraded: 'var(--amber)', unknown: 'var(--grey)' };
  return 'linear-gradient(to right,' + segments.map(segment => {
    const left = (100 * (segment.start - start) / (end - start)).toFixed(5);
    const right = (100 * (segment.end - start) / (end - start)).toFixed(5);
    return `${colors[segment.state]} ${left}% ${right}%`;
  }).join(',') + ')';
}
