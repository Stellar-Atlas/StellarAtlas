import { Buffer } from 'node:buffer';

const [fromArg, toArg] = process.argv.slice(2);
const from = Date.parse(fromArg);
const to = Date.parse(toArg);
if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400_000) {
	console.error('Usage: node ops/analytics/read-api-traffic.mjs <from ISO UTC> <to ISO UTC> (up to 31 days)');
	process.exit(2);
}

const outcomes = ['2xx', '3xx', '4xx', '5xx', '429', 'aborted', 'other'];
const socketPaths = ['/v1/stream/data', '/v1/live/ws', '/v1/status/ws'];
const handshake = ['attempted', 'accepted', 'rejected'];
const routePattern = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD) \/[\w{}./-]{0,180}$/;
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const zeroes = names => Object.fromEntries(names.map(name => [name, 0]));
const routes = new Map();
const websocket = Object.fromEntries(socketPaths.map(path => [path, zeroes(handshake)]));
const totals = zeroes(outcomes);
const windows = [];
let examined = 0;
let invalid = 0;
let boundary = 0;
let deferred = 0;
let limited = false;
let bytes = 0;
let pending = '';

function addLine(line) {
	if (!line.startsWith('{"type":"atlas_public_api_traffic_v1"')) return;
	examined++;
	let item;
	try { item = JSON.parse(line); }
	catch { invalid++; return; }
	const start = Date.parse(item.from);
	const end = Date.parse(item.to);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { invalid++; return; }
	if (start < from || end > to) { boundary++; return; }
	windows.push([start, end]);
	deferred += number(item.deferredFlushes);
	for (const [route, counts] of Object.entries(item.http ?? {})) {
		if (!routePattern.test(route) || (!routes.has(route) && routes.size >= 256)) {
			limited = true;
			continue;
		}
		const bucket = routes.get(route) ?? zeroes(outcomes);
		for (const name of outcomes) {
			const amount = number(counts?.[name]);
			bucket[name] += amount;
			totals[name] += amount;
		}
		routes.set(route, bucket);
	}
	for (const path of socketPaths) for (const name of handshake)
		websocket[path][name] += number(item.websocket?.[path]?.[name]);
}

process.stdin.setEncoding('utf8');
read: for await (const chunk of process.stdin) {
	bytes += Buffer.byteLength(chunk);
	if (bytes > 32 * 1024 * 1024) { limited = true; break; }
	const lines = (pending + chunk).split('\n');
	pending = lines.pop() ?? '';
	if (pending.length > 128 * 1024) { limited = true; pending = ''; break; }
	for (const line of lines) {
		if (line.length > 128 * 1024) { limited = true; continue; }
		addLine(line);
		if (examined >= 10_000) { limited = true; pending = ''; break read; }
	}
}
if (pending && !limited) addLine(pending);

const iso = value => new Date(value).toISOString();
let covered = 0;
let cursor = from;
for (const [start, end] of windows.sort((a, b) => a[0] - b[0])) {
	if (end <= cursor) continue;
	covered += end - Math.max(start, cursor);
	cursor = end;
}
const topRoutes = [...routes].map(([route, counts]) => ({
	route, total: Object.values(counts).reduce((a, b) => a + b, 0), outcomes: counts
})).sort((a, b) => b.total - a.total || a.route.localeCompare(b.route)).slice(0, 20);

console.log(JSON.stringify({
	requestedRange: { from: iso(from), to: iso(to) },
	coverage: {
		windows: windows.length, examined, invalid, boundaryWindowsExcluded: boundary,
		unobservedMilliseconds: to - from - covered, inputLimited: limited, deferredFlushes: deferred,
		note: 'Origin journal only. Unobserved time may be idle or missing; edge and undocumented traffic are not measured.'
	},
	outcomes: totals, topRoutes, websocket
}, null, 2));
