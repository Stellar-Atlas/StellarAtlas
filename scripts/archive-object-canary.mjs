#!/usr/bin/env node

const CHECKPOINT_FREQUENCY = 64;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const GENESIS_CHECKPOINT_LEDGER = 63;
const MAX_URLS = 20;
const OPTION_BOUNDS = {
	concurrency: [1, 8, 'concurrency'],
	'max-bytes': [1024, 8 * 1024 * 1024, 'maxBytes'],
	'timeout-ms': [1000, 60000, 'timeoutMs']
};
const USER_AGENT = 'StellarAtlas archive-object-canary';

const options = parseCliArgs(process.argv.slice(2));

if (options.help) {
	printUsage();
	process.exit(0);
}

if (options.urls.length === 0) {
	printUsage();
	process.exit(2);
}

if (options.urls.length > MAX_URLS) {
	console.error(
		`Refusing ${options.urls.length} URLs. This canary is capped at ${MAX_URLS} archive URLs.`
	);
	process.exit(2);
}

const results = await mapWithConcurrency(options.urls, options.concurrency, (url) =>
	probeArchive(url, options)
);

for (const result of results) {
	printArchiveResult(result);
}

const failedArchives = results.filter((result) => !archivePassed(result));
const requestCount = results.reduce(
	(total, result) => total + result.objects.length,
	0
);

console.log(
	`Summary: archives=${results.length} requests=${requestCount} passed=${
		results.length - failedArchives.length
	} failed=${failedArchives.length}`
);

if (failedArchives.length > 0) {
	process.exitCode = 1;
}

function parseCliArgs(args) {
	try {
		return parseArgs(args);
	} catch (error) {
		console.error(getErrorMessage(error));
		process.exit(2);
	}
}

function parseArgs(args) {
	const parsed = {
		concurrency: DEFAULT_CONCURRENCY,
		help: false,
		maxBytes: DEFAULT_MAX_BYTES,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		urls: []
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--help' || arg === '-h') {
			parsed.help = true;
			continue;
		}

			const option = parseOption(arg, args[index + 1]);
			if (option !== null) {
				index += option.consumedNext ? 1 : 0;
				const [min, max, property] = OPTION_BOUNDS[option.name];
				parsed[property] = parseBoundedInteger(
					option.name,
					option.value,
					min,
					max
				);
				continue;
			}

		if (arg.startsWith('-')) {
			throw new Error(`Unknown option: ${arg}`);
		}

		parsed.urls.push(arg);
	}

	return parsed;
}

function parseOption(arg, nextArg) {
	for (const name of Object.keys(OPTION_BOUNDS)) {
		const prefix = `--${name}=`;
		if (arg.startsWith(prefix)) {
			return {
				consumedNext: false,
				name,
				value: arg.slice(prefix.length)
			};
		}

		if (arg === `--${name}`) {
			if (nextArg === undefined) {
				throw new Error(`Missing value for --${name}`);
			}

			return {
				consumedNext: true,
				name,
				value: nextArg
			};
		}
	}

	return null;
}

function parseBoundedInteger(name, value, min, max) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(`--${name} must be an integer from ${min} to ${max}`);
	}

	return parsed;
}

async function probeArchive(inputUrl, probeOptions) {
	const normalized = normalizeArchiveUrl(inputUrl);
	if (!normalized.ok) {
		return {
			baseUrl: null,
			inputUrl,
			objects: [failedObject('archive-url', inputUrl, normalized.error)],
			warnings: []
		};
	}

	const baseUrl = normalized.url;
	const rootUrl = `${baseUrl}/.well-known/stellar-history.json`;
	const root = await fetchJsonObject('stellar-history', rootUrl, probeOptions);
	const currentLedger = getCurrentLedger(root.json);
	const warnings = [];
	const objects = [root];

	if (currentLedger.ok) {
		const checkpointLedger = getCurrentCheckpointLedger(currentLedger.value);
		if (checkpointLedger === null) {
			warnings.push(
				`currentLedger ${currentLedger.value} is below the genesis checkpoint`
			);
			objects.push(
				await fetchJsonObject(
					`genesis-history ledger=${GENESIS_CHECKPOINT_LEDGER}`,
					buildHistoryUrl(baseUrl, GENESIS_CHECKPOINT_LEDGER),
					probeOptions
				)
			);
		} else {
			if (!isCheckpointLedger(currentLedger.value)) {
				warnings.push(
					`currentLedger ${currentLedger.value} is not a checkpoint; probing closest lower checkpoint ${checkpointLedger}`
				);
			}

			const currentUrl = buildHistoryUrl(baseUrl, checkpointLedger);
			const [current, genesis] = await Promise.all([
				fetchJsonObject(
					`current-history ledger=${checkpointLedger}`,
					currentUrl,
					probeOptions
				),
				fetchJsonObject(
					`genesis-history ledger=${GENESIS_CHECKPOINT_LEDGER}`,
					buildHistoryUrl(baseUrl, GENESIS_CHECKPOINT_LEDGER),
					probeOptions
				)
			]);
			objects.push(current, genesis);
		}
	} else {
		warnings.push(currentLedger.error);
		objects.push(
			await fetchJsonObject(
				`genesis-history ledger=${GENESIS_CHECKPOINT_LEDGER}`,
				buildHistoryUrl(baseUrl, GENESIS_CHECKPOINT_LEDGER),
				probeOptions
			)
		);
	}

	return {
		baseUrl,
		currentLedger: currentLedger.ok ? currentLedger.value : null,
		inputUrl,
		objects,
		warnings
	};
}

function normalizeArchiveUrl(inputUrl) {
	try {
		const url = new URL(inputUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return { error: 'Archive URL must use http or https', ok: false };
		}

		url.hash = '';
		url.search = '';

		const stateSuffix = '/.well-known/stellar-history.json';
		if (url.pathname.endsWith(stateSuffix)) {
			url.pathname = url.pathname.slice(0, -stateSuffix.length);
		}

		url.pathname = url.pathname.replace(/\/+$/, '');
		const normalized = url.toString().replace(/\/$/, '');
		return { ok: true, url: normalized };
	} catch (error) {
		return { error: getErrorMessage(error), ok: false };
	}
}

async function fetchJsonObject(label, requestUrl, probeOptions) {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), probeOptions.timeoutMs);

	try {
		const response = await fetch(requestUrl, {
			headers: {
				accept: 'application/json,*/*;q=0.8',
				'user-agent': USER_AGENT
			},
			redirect: 'follow',
			signal: controller.signal
		});
		const body = await readBody(response, probeOptions.maxBytes);
		const parsed = parseJson(body.text, body.truncated, probeOptions.maxBytes);

		return {
			bodyBytes: body.bytes,
			contentLength: response.headers.get('content-length'),
			contentType: response.headers.get('content-type'),
			durationMs: Date.now() - startedAt,
			error: parsed.ok ? null : parsed.error,
			finalUrl: response.url,
			json: parsed.ok ? parsed.value : null,
			jsonOk: parsed.ok,
			label,
			requestUrl,
			status: response.status,
			statusText: response.statusText,
			truncated: body.truncated
		};
	} catch (error) {
		const message =
			error instanceof Error && error.name === 'AbortError'
				? `timeout after ${probeOptions.timeoutMs}ms`
				: getErrorMessage(error);
		return failedObject(label, requestUrl, message, Date.now() - startedAt);
	} finally {
		clearTimeout(timeout);
	}
}

async function readBody(response, maxBytes) {
	if (response.body === null) {
		return { bytes: 0, text: '', truncated: false };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	let truncated = false;

	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;

		bytes += chunk.value.byteLength;
		if (bytes > maxBytes) {
			truncated = true;
			await reader.cancel();
			break;
		}

		text += decoder.decode(chunk.value, { stream: true });
	}

	text += decoder.decode();

	return { bytes, text, truncated };
}

function parseJson(text, truncated, maxBytes) {
	if (truncated) {
		return {
			error: `body exceeded ${maxBytes} byte canary limit`,
			ok: false
		};
	}

	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (error) {
		return { error: getErrorMessage(error), ok: false };
	}
}

function failedObject(label, requestUrl, error, durationMs = 0) {
	return {
		bodyBytes: 0,
		contentLength: null,
		contentType: null,
		durationMs,
		error,
		finalUrl: null,
		json: null,
		jsonOk: false,
		label,
		requestUrl,
		status: null,
		statusText: null,
		truncated: false
	};
}

function getCurrentLedger(json) {
	if (!isRecord(json)) {
		return {
			error: 'stellar-history JSON did not parse to an object',
			ok: false
		};
	}

	const value = json.currentLedger;
	if (!Number.isSafeInteger(value) || value < 0) {
		return {
			error: 'stellar-history JSON is missing a safe integer currentLedger',
			ok: false
		};
	}

	return { ok: true, value };
}

function buildHistoryUrl(baseUrl, ledger) {
	const hex = ledger.toString(16).padStart(8, '0');
	const prefix = `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 6)}`;

	return `${baseUrl}/history/${prefix}/history-${hex}.json`;
}

function getCurrentCheckpointLedger(ledger) {
	if (ledger < GENESIS_CHECKPOINT_LEDGER) return null;

	return (
		Math.floor((ledger + 1) / CHECKPOINT_FREQUENCY) *
			CHECKPOINT_FREQUENCY -
		1
	);
}

function isCheckpointLedger(ledger) {
	return (ledger + 1) % CHECKPOINT_FREQUENCY === 0;
}

async function mapWithConcurrency(items, concurrency, mapper) {
	const results = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => worker()
	);
	await Promise.all(workers);

	return results;
}

function archivePassed(result) {
	if (result.baseUrl === null) return false;

	const labels = new Set(result.objects.map((object) => object.label));
	if (!labels.has('stellar-history')) return false;
	if (![...labels].some((label) => label.startsWith('current-history'))) {
		return false;
	}
	if (![...labels].some((label) => label.startsWith('genesis-history'))) {
		return false;
	}

	return result.objects.every(
		(object) =>
			typeof object.status === 'number' &&
			object.status >= 200 &&
			object.status < 300 &&
			object.jsonOk
	);
}

function printArchiveResult(result) {
	console.log(`\nArchive: ${result.inputUrl}`);
	if (result.baseUrl !== null && result.baseUrl !== result.inputUrl) {
		console.log(`  normalized=${result.baseUrl}`);
	}
	if (typeof result.currentLedger === 'number') {
		console.log(`  currentLedger=${result.currentLedger}`);
	}

	for (const warning of result.warnings) {
		console.log(`  warning=${warning}`);
	}

	for (const object of result.objects) {
		console.log(`  ${object.label}: ${formatObjectResult(object)}`);
	}

	console.log(`  result=${archivePassed(result) ? 'pass' : 'fail'}`);
}

function formatObjectResult(object) {
	const status =
		typeof object.status === 'number'
			? `${object.status} ${object.statusText ?? ''}`.trim()
			: 'request-failed';
	const contentType = object.contentType ?? 'none';
	const contentLength = object.contentLength ?? 'unknown';
	const finalUrl = object.finalUrl ?? 'none';
	const parse = object.jsonOk ? 'ok' : `fail (${object.error})`;

	return [
		`status=${status}`,
		`final=${finalUrl}`,
		`type=${contentType}`,
		`length=${contentLength}`,
		`bytes=${object.bodyBytes}`,
		`json=${parse}`,
		`durationMs=${object.durationMs}`
	].join(' ');
}

function printUsage() {
	console.log(
		[
			'Usage: node scripts/archive-object-canary.mjs [options] <historyArchiveUrl...>',
			'',
			'Options:',
			`  --concurrency <n>   Archive URLs to probe at once, 1-8. Default: ${DEFAULT_CONCURRENCY}`,
			`  --timeout-ms <n>    Per-request timeout, 1000-60000. Default: ${DEFAULT_TIMEOUT_MS}`,
			`  --max-bytes <n>     Per-response body cap, 1024-8388608. Default: ${DEFAULT_MAX_BYTES}`,
			'',
			'For each archive URL, probes the root stellar-history JSON, the current checkpoint history JSON, and the genesis checkpoint history JSON.'
		].join('\n')
	);
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
