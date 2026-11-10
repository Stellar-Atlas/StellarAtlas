import { constants, openSync, readFileSync, closeSync, fstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://api.cloudflare.com/client/v4/graphql';
const snapshotPath = '/srv/stellaratlas/analytics-data/api-traffic/edge/traffic.json';
const hosts = new Set(['stellaratlas.io', 'www.stellaratlas.io', 'api.stellaratlas.io',
	'status.stellaratlas.io', 'analytics.stellaratlas.io']);
const caches = new Set(['hit', 'miss', 'expired', 'stale', 'bypass', 'revalidated',
	'updating', 'dynamic', 'none', 'unknown']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const interval = value => typeof value === 'number' && Number.isFinite(value) && value >= 1;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
	&& Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Closed rolling window; each refresh replaces the snapshot, never adds counts.
export function edgeWindow(now = Date.now()) {
	const end = Math.floor((now - 600_000) / 300_000) * 300_000;
	return { from: new Date(end - 86400_000).toISOString(), to: new Date(end).toISOString(),
		semantics: 'inclusive start, exclusive end', seconds: 86400, requestedWithAtLeastSecondsLag: 600 };
}

export function edgeQuery(zone, window) {
	if (!/^[a-f0-9]{32}$/.test(zone) || !validWindow(window)) throw new Error('Invalid edge query configuration');
	const filter = `datetime_geq:${JSON.stringify(window.from)},datetime_lt:${JSON.stringify(window.to)},requestSource:"eyeball"`;
	return `{viewer{zones(filter:{zoneTag:${JSON.stringify(zone)}}){total:httpRequestsAdaptiveGroups(limit:1 filter:{${filter}}){count avg{sampleInterval}}breakdown:httpRequestsAdaptiveGroups(limit:10 orderBy:[count_DESC] filter:{${filter}}){count avg{sampleInterval} dimensions{clientRequestHTTPHost edgeResponseStatus cacheStatus}}}}}`;
}

function validWindow(value) {
	return value && iso(value.from) && iso(value.to) && value.semantics === 'inclusive start, exclusive end'
		&& value.seconds === 86400 && value.requestedWithAtLeastSecondsLag === 600
		&& Date.parse(value.to) - Date.parse(value.from) === 86400_000;
}

function safeGroup(group) {
	if (!integer(group?.providerCount) || !interval(group.reportedAverageSampleInterval) ||
		!integer(group.edgeStatus) || group.edgeStatus > 599) throw new Error('Invalid edge group');
	return { host: hosts.has(group.host) ? group.host : 'other-zone-host',
		edgeStatus: group.edgeStatus, cacheStatus: caches.has(group.cacheStatus) ? group.cacheStatus : 'other',
		providerCount: group.providerCount, reportedAverageSampleInterval: group.reportedAverageSampleInterval };
}

export function sanitizeEdgeSnapshot(value) {
	const edge = value?.edge;
	if (value?.schemaVersion !== 1 || value.source !== 'cloudflare_graphql_analytics' ||
		!iso(value.generatedAtUtc) || !validWindow(value.window) ||
		edge?.scope !== 'stellaratlas.io zone' || edge.requestSource !== 'eyeball' ||
		!integer(edge.providerCount) || !interval(edge.sampling?.reportedAverageSampleInterval) ||
		!Array.isArray(edge.groups) || edge.groups.length > 10) throw new Error('Invalid edge snapshot');
	return { schemaVersion: 1, source: 'cloudflare_graphql_analytics', generatedAtUtc: value.generatedAtUtc,
		window: { from: value.window.from, to: value.window.to, semantics: 'inclusive start, exclusive end',
			seconds: 86400, requestedWithAtLeastSecondsLag: 600 },
		edge: { scope: 'stellaratlas.io zone', requestSource: 'eyeball', unit: 'requests_not_people',
			providerCount: edge.providerCount,
			sampling: { dataset: 'adaptive', reportedAverageSampleInterval: edge.sampling.reportedAverageSampleInterval,
				confidence: null, exhaustiveEventLedgerClaim: false },
			breakdownLimit: 10, breakdownReturned: edge.groups.length, breakdownIsNotTheTotalQuery: true,
			groups: edge.groups.map(safeGroup) },
		coverage: { providerIngestionCanBeDelayed: true, missingMeansUnknownNotZero: true,
			browserPageviewsOrOriginTotalsAreNotAdditive: true, websocketMessageCount: null, fallbackBranchCount: null } };
}

export async function collectEdgeTraffic(zone, token, send = fetch, now = Date.now()) {
	if (typeof token !== 'string' || !/^[\x21-\x7e]{20,2048}$/.test(token)) throw new Error('Invalid edge credential');
	const window = edgeWindow(now);
	const response = await send(endpoint, { method: 'POST', redirect: 'error',
		headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: edgeQuery(zone, window) }), signal: AbortSignal.timeout(10_000) });
	if (!response.ok || !response.body) throw new Error('Edge provider unavailable');
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 64 * 1024) throw new Error('Edge response exceeds limit');
			chunks.push(value);
		}
	} finally { await reader.cancel().catch(() => {}); }
	const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	const zones = result?.data?.viewer?.zones;
	if (result.errors?.length || !Array.isArray(zones) || zones.length !== 1 ||
		!Array.isArray(zones[0].total) || zones[0].total.length > 1 ||
		!Array.isArray(zones[0].breakdown) || zones[0].breakdown.length > 10)
		throw new Error('Edge response unavailable');
	const total = zones[0].total[0];
	// An empty provider series is not evidence of zero requests.
	if (!total) throw new Error('Edge provider returned no aggregate');
	return sanitizeEdgeSnapshot({ schemaVersion: 1, source: 'cloudflare_graphql_analytics',
		generatedAtUtc: new Date(now).toISOString(), window,
		edge: { scope: 'stellaratlas.io zone', requestSource: 'eyeball', providerCount: total.count,
			sampling: { reportedAverageSampleInterval: total.avg?.sampleInterval },
			groups: zones[0].breakdown.map(group => ({ host: group.dimensions?.clientRequestHTTPHost,
				edgeStatus: group.dimensions?.edgeResponseStatus, cacheStatus: group.dimensions?.cacheStatus,
				providerCount: group.count, reportedAverageSampleInterval: group.avg?.sampleInterval })) } });
}

function readBounded(path, maxBytes) {
	const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = fstatSync(file);
		if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid snapshot file');
		return readFileSync(file, 'utf8');
	} finally { closeSync(file); }
}

export function readEdgeState(path = snapshotPath) {
	try {
		const value = JSON.parse(readBounded(path, 64 * 1024));
		if (!['ready', 'error'].includes(value.state) || !iso(value.checkedAtUtc)) throw new Error();
		return { state: value.state, checkedAtUtc: value.checkedAtUtc,
			lastGood: value.lastGood ? sanitizeEdgeSnapshot(value.lastGood) : null };
	} catch (error) {
		return { state: error?.code === 'ENOENT' ? 'not_collecting' : 'unavailable', lastGood: null };
	}
}

function publish(value) {
	const temporary = snapshotPath + '.' + randomUUID() + '.tmp';
	try {
		writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o640 });
		renameSync(temporary, snapshotPath);
	} finally { rmSync(temporary, { force: true }); }
}

async function main() {
	const checkedAtUtc = new Date().toISOString();
	try {
		const directory = process.env.CREDENTIALS_DIRECTORY;
		if (!directory?.startsWith('/run/credentials/')) throw new Error('Credential binding unavailable');
		const token = readBounded(directory + '/cloudflare-analytics-token', 2048).trim();
		const lastGood = await collectEdgeTraffic(process.env.CF_ZONE_ID, token);
		publish({ state: 'ready', checkedAtUtc, lastGood });
	} catch {
		publish({ state: 'error', checkedAtUtc, lastGood: readEdgeState().lastGood });
		console.error('Edge traffic refresh failed; previous measured snapshot retained when available.');
		process.exitCode = 1;
	}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	main().catch(() => { console.error('Edge traffic snapshot publication failed.'); process.exitCode = 1; });
}
