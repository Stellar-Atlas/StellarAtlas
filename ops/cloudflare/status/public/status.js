import { ranges, segmentsFor, duration, gradient } from './history.mjs';
import { reportedReason, causes } from './incident-reasons.mjs';
const labels = { primary: 'Primary server', data: 'Data server', failover: 'Failover service' };
const stamp = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Not available';
function text(id, value) { document.getElementById(id).textContent = value; }
function badge(id, state, standby) { const e = document.getElementById(id); e.className = 'badge ' + state; e.textContent = state === 'operational' ? standby ? 'Ready' : 'Operational' : state === 'degraded' ? 'Degraded' : 'Unknown'; }
let historyData, historyRange = '1h', historyEnd = null;
const timeLabel = value => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(value));
function describeSegments(segments) {
  const totals = { operational: 0, degraded: 0, unknown: 0 };
  for (const segment of segments) totals[segment.state] += segment.end - segment.start;
  return [totals.operational && duration(totals.operational) + ' without a recorded outage',
    totals.degraded && duration(totals.degraded) + ' interrupted', totals.unknown && duration(totals.unknown) + ' not monitored'].filter(Boolean).join(' · ');
}
function renderHistory(data) {
  historyData = data;
  const now = Date.now(), range = ranges.find(item => item.id === historyRange);
  const end = Math.min(historyEnd ?? now, now), start = end - range.ms;
  const root = document.getElementById('history'); root.replaceChildren();
  text('history-window', timeLabel(start) + ' — ' + timeLabel(end) + ' UTC');
  document.getElementById('history-forward').disabled = historyEnd === null || end >= now;
  document.getElementById('history-latest').disabled = historyEnd === null;
  for (const button of document.getElementById('history-ranges').children) button.setAttribute('aria-pressed', String(button.dataset.range === historyRange));
  for (const [component, label] of Object.entries(labels)) {
    const row = document.createElement('div'); row.className = 'history-row';
    const heading = document.createElement('div'); heading.className = 'history-row-heading';
    const name = document.createElement('span'); name.textContent = label;
    const summary = document.createElement('span');
    const total = segmentsFor(data, component, start, end, now);
    const down = total.filter(item => item.state === 'degraded').reduce((sum, item) => sum + item.end - item.start, 0);
    const monitored = total.some(item => item.state === 'operational');
    summary.textContent = down ? duration(down) + ' interrupted' : monitored ? 'No recorded outage' : 'Not monitored';
    heading.append(name, summary);
    const track = document.createElement('div'); track.className = 'history-track'; track.style.setProperty('--slots', range.slots);
    for (let index = 0; index < range.slots; index++) {
      const from = start + range.ms * index / range.slots, to = start + range.ms * (index + 1) / range.slots;
      const segments = segmentsFor(data, component, from, to, now);
      const details = `${label} · ${timeLabel(from)} — ${timeLabel(to)} UTC · ${describeSegments(segments)}`;
      const slot = document.createElement('button'); slot.type = 'button'; slot.className = 'history-slot';
      slot.style.background = gradient(segments, from, to); slot.title = details; slot.setAttribute('aria-label', details);
      slot.addEventListener('click', () => {
        const next = ranges[Math.max(0, ranges.indexOf(range) - 1)];
        historyRange = next.id;
        historyEnd = Math.min(now, (from + to + next.ms) / 2);
        renderHistory(historyData); text('history-selection', details);
      });
      track.append(slot);
    }
    row.append(heading, track); root.append(row);
  }
  const axis = document.getElementById('history-axis'); axis.replaceChildren();
  for (const point of [start, start + range.ms / 2, end]) {
    const label = document.createElement('span'); label.textContent = timeLabel(point); axis.append(label);
  }
}
for (const range of ranges) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = range.label; button.dataset.range = range.id;
  button.setAttribute('aria-pressed', String(range.id === historyRange));
  button.addEventListener('click', () => { historyRange = range.id; if (historyData) renderHistory(historyData); });
  document.getElementById('history-ranges').append(button);
}
document.getElementById('history-back').addEventListener('click', () => {
  historyEnd = (historyEnd ?? Date.now()) - ranges.find(item => item.id === historyRange).ms;
  if (historyData) renderHistory(historyData);
});
document.getElementById('history-forward').addEventListener('click', () => {
  const next = historyEnd + ranges.find(item => item.id === historyRange).ms;
  historyEnd = next >= Date.now() ? null : next;
  if (historyData) renderHistory(historyData);
});
document.getElementById('history-latest').addEventListener('click', () => {
  historyEnd = null; if (historyData) renderHistory(historyData);
});
function renderIncidents(data) {
  const root = document.getElementById('incidents'); root.replaceChildren();
  if (!data.recentIncidents.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No recorded incidents in the monitored period.'; root.append(p); return; }
  for (const item of data.recentIncidents.slice(0, 100)) {
    const article = document.createElement('article'); article.className = 'incident';
    const heading = document.createElement('div'); heading.className = 'incident-heading';
    const name = document.createElement('strong'); name.textContent = labels[item.component] ?? 'Service';
    const state = document.createElement('span'); state.textContent = item.endedAt ? 'Resolved' : 'Ongoing'; heading.append(name, state);
    const detail = document.createElement('p'); detail.textContent = reportedReason(item) + ' · ' + stamp(item.startedAt) + (item.endedAt ? ' — ' + stamp(item.endedAt) : ' — ongoing')
      + ' · ' + duration((item.endedAt ?? Date.now()) - item.startedAt) + (item.confidence === 'inferred' ? ' · Historical estimate' : '');
    article.append(heading, detail);
    if (item.cause) {
      const cause = document.createElement('p'); cause.textContent = (causes[item.cause.code] ?? 'Cause') + ': ' + item.cause.summary;
      article.append(cause);
    }
    root.append(article);
  }
}
async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Unavailable'); const data = await response.json();
    if (!Array.isArray(data.components) || !Array.isArray(data.recentIncidents)) throw new Error('Invalid');
    const stale = !data.lastCheckedAt || Date.now() - data.lastCheckedAt > 180000;
    const components = new Map(data.components.map(x => [x.id, x]));
    for (const id of Object.keys(labels)) badge(id, stale ? 'unknown' : components.get(id)?.state ?? 'unknown', id === 'failover');
    const failed = !stale && [...components.values()].some(x => x.state === 'degraded');
    const unknown = stale || components.size !== 3 || [...components.values()].some(x => x.state === 'unknown');
    const overall = failed ? 'degraded' : unknown ? 'unknown' : 'operational';
    document.getElementById('overall-dot').className = 'dot ' + overall;
    text('overall', failed ? 'Degraded service' : unknown ? 'Status check unavailable' : 'All services operational');
    text('summary-detail', failed ? components.get('failover')?.state === 'operational' ? 'Live service is interrupted. The failover service is available.' : 'A service interruption is being investigated.' : unknown ? 'The latest check is unavailable. Last known information is shown below.' : 'Live services are available. The failover service is ready if needed.');
    text('checked', 'Last checked ' + stamp(data.lastCheckedAt));
    text('monitoring-since', data.monitoringSince ? 'Service checks recorded since ' + stamp(data.monitoringSince) + '. Earlier periods are not monitored.' : 'Independent monitoring is starting.');
    text('core-snapshot', stamp(components.get('primary')?.snapshotAt));
    text('explorer-snapshot', stamp(components.get('data')?.snapshotAt));
    renderHistory(data); renderIncidents(data);
  } catch {
    text('overall', 'Status check unavailable'); text('summary-detail', 'The status service could not load its latest check.');
    document.getElementById('overall-dot').className = 'dot unknown';
    for (const id of Object.keys(labels)) badge(id, 'unknown');
  }
}
await refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
