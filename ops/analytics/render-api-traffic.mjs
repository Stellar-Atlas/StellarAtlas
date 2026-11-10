import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEdgeState, sanitizeEdgeSnapshot } from './edge-traffic.mjs';

const presets = [
	{ id: 'hour', label: 'Last hour', hours: 1 },
	{ id: 'day', label: 'Last 24 hours', hours: 24 }
];
const outcomes = ['2xx', '3xx', '4xx', '5xx', '429', 'aborted', 'other'];
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const journalLimit = 1600;
const journalPrefix = '{"type":"atlas_public_api_traffic_v1"';
const apiUnit = 'stellaratlas-api-contract-catalogue.service';
const openApiPath = '/opt/stellaratlas/atlas-analytics/api-traffic/public-openapi.json';
const reportPath = '/srv/stellaratlas/analytics-data/api-traffic/index.html';
const reader = fileURLToPath(new URL('./read-api-traffic.mjs', import.meta.url));
const number = new Intl.NumberFormat('en-US');
const timestamp = value => new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const html = value => String(value).replace(/[&<>"']/g, character => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function row(label, values) {
	return `<tr><th scope="row"><code>${html(label)}</code></th>${values.map(value => `<td>${number.format(value)}</td>`).join('')}</tr>`;
}

export function publicRoutes(document) {
	const routes = new Set();
	for (const [path, operations] of Object.entries(document.paths ?? {})) {
		if (!/^\/[\w{}./-]{0,180}$/.test(path) || !operations || typeof operations !== 'object') continue;
		for (const method of methods) {
			if (Object.hasOwn(operations, method)) routes.add(method.toUpperCase() + ' ' + path);
		}
	}
	if (routes.size === 0 || routes.size > 256) throw new Error('Unexpected public API route count');
	for (const label of ['UNMATCHED_ROUTE', 'UNSUPPORTED_METHOD', 'INVALID_PATH']) routes.add(label);
	return routes;
}

export function filterJournal(journal, routes) {
	const summaries = [];
	for (const line of journal.split('\n')) {
		if (!line.startsWith(journalPrefix)) continue;
		try {
			if (Buffer.byteLength(line) > 128 * 1024) throw new Error('Aggregate summary exceeds size limit');
			const { type, from, to, deferredFlushes, httpScope, http, websocket } = JSON.parse(line);
			if (type !== 'atlas_public_api_traffic_v1') throw new Error('Invalid aggregate summary');
			const entries = Object.entries(http ?? {});
			const known = entries.filter(([route]) => routes.has(route));
			summaries.push({
				start: Date.parse(from), end: Date.parse(to), rejected: entries.length - known.length,
				line: JSON.stringify({ type, from, to, deferredFlushes,
					...(httpScope === 'all_express_requests' ? { httpScope } : {}), http: Object.fromEntries(known), websocket })
			});
		} catch {
			summaries.push({ line: journalPrefix });
		}
	}
	return summaries;
}

function renderWindow(preset, report, journalCapped) {
	const { requestedRange, coverage, outcomes: totals, topRoutes, websocket } = report;
	const duration = Date.parse(requestedRange.to) - Date.parse(requestedRange.from);
	const unobserved = coverage.unobservedMilliseconds;
	const observed = duration - unobserved;
	const requests = outcomes.reduce((sum, outcome) => sum + totals[outcome], 0);
	const errors = totals['4xx'] + totals['5xx'] + totals['429'];
	const max = Math.max(1, ...outcomes.map(outcome => totals[outcome]));
	const chart = outcomes.map(outcome => `<li><span>${outcome}</span><meter min="0" max="${max}" value="${totals[outcome]}" aria-hidden="true"></meter><strong>${number.format(totals[outcome])}</strong></li>`).join('');
	const routes = topRoutes.map(route => row(route.route, [route.total, ...outcomes.map(outcome => route.outcomes[outcome])])).join('');
	const sockets = Object.entries(websocket).map(([path, counts]) =>
		row(path, [counts.attempted, counts.accepted, counts.rejected])).join('');
	const limited = journalCapped || coverage.inputLimited
		? '<p class="notice">A journal or reader limit was reached. Counts may be incomplete.</p>'
		: '';
	const observedRange = coverage.observedFrom
		? `First included window began ${timestamp(coverage.observedFrom)}. Last included window ended ${timestamp(coverage.observedTo)}. Coverage can have gaps.`
		: coverage.windows > 0
			? 'The report includes some windows, but the full observed span is unavailable.'
			: 'No complete aggregate windows were observed. This does not establish zero traffic.';
	return `<section id="${preset.id}" aria-labelledby="${preset.id}-heading">
	<h2 id="${preset.id}-heading">${preset.label}</h2>
	<p><time datetime="${html(requestedRange.from)}">${timestamp(requestedRange.from)}</time> to
	<time datetime="${html(requestedRange.to)}">${timestamp(requestedRange.to)}</time></p>
	<dl class="summary">
		<div><dt>Observed HTTP requests</dt><dd>${number.format(requests)}</dd></div>
		<div><dt>HTTP errors</dt><dd>${number.format(errors)}</dd></div>
		<div><dt>Aborted requests</dt><dd>${number.format(totals.aborted)}</dd></div>
	</dl>
	<p>HTTP errors combine 4xx, 5xx and 429. Aborts are counted separately. GraphQL errors returned with HTTP 200 count as 2xx.</p>
	<h3>HTTP outcomes</h3>
	<ul class="chart">${chart}</ul>
	<h3>Top 20 routes</h3>
	${routes ? `<div class="scroll" role="region" aria-label="${preset.label} route breakdown" tabindex="0"><table>
		<thead><tr><th scope="col">Route template</th><th scope="col">Total</th>${outcomes.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead>
		<tbody>${routes}</tbody></table></div>` : '<p>No HTTP routes were observed in the included windows.</p>'}
	<h3>WebSocket handshakes</h3>
	<div class="scroll" role="region" aria-label="${preset.label} WebSocket handshakes" tabindex="0"><table>
		<thead><tr><th scope="col">Endpoint</th><th scope="col">Attempts</th><th scope="col">Accepted</th><th scope="col">App-policy rejections</th></tr></thead>
		<tbody>${sockets}</tbody></table></div>
	<h3>Data coverage</h3>
	${limited}
	<p>${observedRange}</p>
	<dl class="coverage">
		<div><dt>Included aggregate windows</dt><dd>${number.format(coverage.windows)}</dd></div>
		<div><dt>All-request observer windows</dt><dd>${number.format(coverage.allRequestWindows)}</dd></div>
		<div><dt>Older route-only windows</dt><dd>${number.format(coverage.legacyRouteOnlyWindows)}</dd></div>
		<div><dt>Time covered by included windows</dt><dd>${number.format(Math.round(observed / 1000))} s</dd></div>
		<div><dt>Unobserved time</dt><dd>${number.format(Math.round(unobserved / 1000))} s</dd></div>
		<div><dt>Boundary windows excluded</dt><dd>${number.format(coverage.boundaryWindowsExcluded)}</dd></div>
		<div><dt>Invalid summaries</dt><dd>${number.format(coverage.invalid)}</dd></div>
		<div><dt>Unrecognized aggregate labels excluded</dt><dd>${number.format(coverage.rejectedRouteEntries)}</dd></div>
		<div><dt>Deferred flushes</dt><dd>${number.format(coverage.deferredFlushes)}</dd></div>
	</dl>
	<p>Deferred flushes count delays. The source does not measure lost requests. Unobserved time can be idle or missing, and a process exit can lose an unflushed window.</p>
</section>`;
}

export function renderEdgeTraffic(state, generatedAt) {
	const heading = '<section aria-labelledby="edge-heading"><h2 id="edge-heading">Edge requests</h2>';
	let saved;
	try { saved = state?.lastGood ? sanitizeEdgeSnapshot(state.lastGood) : null; }
	catch { saved = null; }
	if (!saved) return heading + `<p>${state?.state === 'not_collecting' || !state
		? 'Not yet collecting.' : 'Collection unavailable.'} No edge request total is available; this is not zero traffic.</p></section>`;
	const stale = state.state !== 'ready' || Date.parse(generatedAt) - Date.parse(saved.generatedAtUtc) > 20 * 60_000 ||
		Date.parse(saved.generatedAtUtc) > Date.parse(generatedAt);
	const groups = saved.edge.groups.map(group => `<tr><th scope="row">${html(group.host)}</th><td>${html(group.cacheStatus)}</td>
		<td>${number.format(group.edgeStatus)}</td><td>${number.format(group.providerCount)}</td>
		<td>${number.format(group.reportedAverageSampleInterval)}</td></tr>`).join('');
	return heading + `${stale ? '<p class="notice">Refresh unavailable or stale. Showing the last measured window.</p>' : ''}
	${state.state === 'error' && Number.isFinite(Date.parse(state.checkedAtUtc)) ? `<p>Latest attempt ${timestamp(state.checkedAtUtc)} did not produce a fresh result.</p>` : ''}
	<p>${number.format(saved.edge.providerCount)} provider-reported client requests across the zone, from ${timestamp(saved.window.from)} to ${timestamp(saved.window.to)} (UTC; end exclusive).</p>
	<p>Collected ${timestamp(saved.generatedAtUtc)}. Adaptive sampling: average interval ${number.format(saved.edge.sampling.reportedAverageSampleInterval)}. Counts are reported as supplied, not multiplied by the interval. Provider reporting can be delayed; this is not an exhaustive event ledger.</p>
	<div class="scroll" role="region" aria-label="Edge request groups" tabindex="0"><table>
	<thead><tr><th>Host</th><th>Cache</th><th>HTTP status</th><th>Requests</th><th>Sample interval</th></tr></thead><tbody>${groups}</tbody></table></div>
	<p>Top ${saved.edge.breakdownReturned} groups, limited to 10; their sum is not the separate total query. Edge counts overlap origin requests and browser activity; do not add them together. Worker invocations, subrequests and security events are separate. Exact failover-branch counts and WebSocket message counts are not measured.</p></section>`;
}

export function renderDashboard(reports, generatedAt, journalCapped, edgeState) {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>API traffic | StellarAtlas Analytics</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}
body{margin:0;background:Canvas;color:CanvasText}
main{max-width:68rem;padding:1.5rem;margin:auto}
a{color:LinkText;text-underline-offset:.2em}
nav{display:flex;gap:1rem;flex-wrap:wrap}
h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;margin-bottom:.5rem}
h2{margin:0;font-size:1.65rem}
section{margin-block:2rem;padding-block-start:1.5rem;border-block-start:1px solid GrayText}
section>p{max-width:72ch}
.summary,.coverage{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));gap:.7rem}
.summary div,.coverage div{padding:.75rem;border:1px solid GrayText;border-radius:.4rem}
dd{margin:0;font-variant-numeric:tabular-nums;font-weight:650}
.summary dd{font-size:1.8rem}
.chart{list-style:none;padding:0;max-width:38rem}
.chart li{display:grid;grid-template-columns:4.5rem 1fr minmax(4rem,auto);gap:.8rem;align-items:center}
meter{width:100%;height:1.25rem}
.chart strong,td{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:34rem}
th,td{padding:.45rem .6rem;border-bottom:1px solid GrayText}
th{text-align:left;font-weight:650}
tbody th{overflow-wrap:anywhere}
.notice{padding:.55rem;border:2px solid currentColor}
:focus-visible{outline:2px solid Highlight;outline-offset:3px}
</style></head><body><main>
<nav aria-label="Analytics views"><a href="/">Analytics home</a><a href="/stellaratlas.io">Website analytics</a><a href="#hour">Last hour</a><a href="#day">Last 24 hours</a></nav>
<h1>API traffic</h1>
<p>Private HTTP totals for one StellarAtlas API origin process, including fixed buckets for unmatched routes, unsupported methods and invalid paths after the observer update. Older windows omit those requests. Requests rejected before reaching this process are not counted here. WebSocket handshakes are separate from HTTP requests and message traffic.</p>
<p>HTTP 2xx is not proof of application success. Browser pageviews honor privacy preferences and are not request totals. Edge requests overlap origin traffic; never add those counts together.</p>
<p>Snapshot generated <time datetime="${html(generatedAt)}">${timestamp(generatedAt)}</time>. Reload for the latest available snapshot.</p>
${renderEdgeTraffic(edgeState, generatedAt)}
${presets.map((preset, index) => renderWindow(preset, reports[index], journalCapped)).join('\n')}
</main></body></html>\n`;
}

function loadPublicRoutes() {
	const file = openSync(openApiPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = fstatSync(file);
		if (!info.isFile() || info.size > 32 * 1024) throw new Error('Invalid public OpenAPI snapshot');
		return publicRoutes(JSON.parse(readFileSync(file, 'utf8')));
	} finally {
		closeSync(file);
	}
}

function publishDashboard() {
	const routes = loadPublicRoutes();
	const end = new Date();
	const starts = presets.map(({ hours }) => new Date(end.getTime() - hours * 3600_000).toISOString());
	const to = end.toISOString();
	const journalTime = iso => iso.replace('T', ' ').replace('Z', ' UTC');
	const journal = spawnSync('/usr/bin/journalctl', [
		'--unit', apiUnit, '--since', journalTime(starts.at(-1)), '--until', journalTime(to),
		'--output=cat', '--no-pager', '--quiet', '--grep', '^\\{"type":"atlas_public_api_traffic_v1"',
		'--lines', String(journalLimit)
	], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 8_000, killSignal: 'SIGKILL' });
	const empty = journal.status === 1 && !journal.stdout && !journal.stderr;
	if (journal.error || (journal.status !== 0 && !empty)) throw new Error('Journal read failed');
	const summaries = filterJournal(journal.stdout, routes);
	const journalCapped = summaries.length >= journalLimit;
	const input = summaries.map(summary => summary.line).join('\n');
	const reports = starts.map(from => {
		const report = JSON.parse(execFileSync(process.execPath, [reader, from, to], {
			input, encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 8_000
		}));
		const start = Date.parse(from);
		const included = summaries.filter(summary =>
			summary.start >= start && summary.end <= end.getTime() && summary.end > summary.start);
		report.coverage.rejectedRouteEntries = included.reduce((sum, summary) => sum + summary.rejected, 0);
		if (included.length && included.length === report.coverage.windows) {
			report.coverage.observedFrom = Math.min(...included.map(summary => summary.start));
			report.coverage.observedTo = Math.max(...included.map(summary => summary.end));
		}
		return report;
	});
	const temporary = reportPath + '.' + randomUUID() + '.tmp';
	try {
		writeFileSync(temporary, renderDashboard(reports, to, journalCapped, readEdgeState()), { flag: 'wx', mode: 0o640 });
		renameSync(temporary, reportPath);
	} finally {
		rmSync(temporary, { force: true });
	}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	try {
		publishDashboard();
	} catch {
		console.error('API traffic snapshot refresh failed.');
		process.exitCode = 1;
	}
}
