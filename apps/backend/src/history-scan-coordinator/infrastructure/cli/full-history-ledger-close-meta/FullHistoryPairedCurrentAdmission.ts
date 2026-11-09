import { lstat, readFile, statfs } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DataSource } from 'typeorm';
import type { PendingPlan } from './FullHistoryLedgerCloseMetaPendingPlan.js';
import { readCurrentSourcePublication } from './FullHistoryPairedSourceManifest.js';
import type {
	ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	ContinuousFullHistoryLedgerCloseMetaLoopDependencies
} from './ContinuousFullHistoryLedgerCloseMetaLoop.js';

export interface PairedCurrentAdmissionPolicy {
	readonly bootId: string;
	readonly warehouseReportedPath: string;
	readonly warehouseMetadataPath: string;
	readonly warehouseMetadataInode: bigint;
	readonly minimumUnreservedBytes: bigint;
}

export interface PairedCurrentAdmission {
	assertCapacity(plan: PendingPlan, signal: AbortSignal): Promise<void>;
	pendingPublication(plan: PendingPlan, signal: AbortSignal): Promise<
		'not-captured' | 'waiting' | 'published'
	>;
}

export interface PairedFilesystem {
	readonly device: bigint;
	readonly inode: bigint;
	readonly total: bigint;
	readonly available: bigint;
}

interface AdmissionConfig {
	readonly bulkRoot: string;
	readonly typedOutputRoot: string;
	readonly minimumFreeBasisPoints: number;
	readonly currentMinimumFreeBytes: bigint;
	readonly sourceOutputBytes: bigint;
}

const maximumEvidenceAgeMs = 4_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const datasets = [
	'account_signers', 'accounts', 'claimable_balances', 'config_settings',
	'contract_code', 'contract_data', 'history_assets', 'history_contract_events',
	'history_effects', 'history_ledgers', 'history_operations', 'history_trades',
	'history_transactions', 'ledger_transactions', 'liquidity_pools', 'offers',
	'restored_key', 'token_transfers', 'trustlines', 'ttl'
] as const;

export function parsePairedCurrentAdmissionPolicy(
	raw: string | undefined
): PairedCurrentAdmissionPolicy | undefined {
	if (raw === undefined) return undefined;
	let input: Record<string, unknown>;
	try {
		if (raw.length > 4096) throw new Error();
		input = record(JSON.parse(raw));
	} catch {
		throw new Error('Invalid paired current admission policy');
	}
	const fields = ['bootId', 'warehouseReportedPath', 'warehouseMetadataPath',
		'warehouseMetadataInode', 'minimumUnreservedBytes'];
	if (Object.keys(input).length !== fields.length || fields.some((k) => !Object.hasOwn(input, k)) ||
		typeof input.bootId !== 'string' || !uuid.test(input.bootId) ||
		!canonicalPath(input.warehouseReportedPath) || !canonicalPath(input.warehouseMetadataPath) ||
		!input.warehouseMetadataPath.startsWith('/run/') ||
		input.warehouseReportedPath === input.warehouseMetadataPath) {
		throw new Error('Invalid paired current admission binding');
	}
	return Object.freeze({
		bootId: input.bootId,
		warehouseReportedPath: input.warehouseReportedPath,
		warehouseMetadataPath: input.warehouseMetadataPath,
		warehouseMetadataInode: positiveUint(input.warehouseMetadataInode),
		minimumUnreservedBytes: positiveUint(input.minimumUnreservedBytes)
	});
}

export function createPairedCurrentAdmission(
	policy: PairedCurrentAdmissionPolicy,
	config: AdmissionConfig,
	environment: NodeJS.ProcessEnv,
	dataSource: DataSource
): PairedCurrentAdmission {
	let endpoint: URL;
	try {
		endpoint = new URL(environment.HUBBLE_CLICKHOUSE_URL ?? '');
	} catch {
		throw new Error('Paired current admission requires an explicit local warehouse binding');
	}
	const database = environment.HUBBLE_CLICKHOUSE_DATABASE;
	if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
		endpoint.port !== '8123' || endpoint.pathname !== '/' || endpoint.search !== '' ||
		endpoint.hash !== '' || endpoint.username !== '' || endpoint.password !== '' ||
		database === undefined || !/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
		throw new Error('Paired current admission requires an explicit local warehouse binding');
	}
	const headers: Record<string, string> = {
		Accept: 'application/json', 'Content-Type': 'text/plain'
	};
	if (environment.HUBBLE_CLICKHOUSE_USER)
		headers['X-ClickHouse-User'] = environment.HUBBLE_CLICKHOUSE_USER;
	if (environment.HUBBLE_CLICKHOUSE_PASSWORD)
		headers['X-ClickHouse-Key'] = environment.HUBBLE_CLICKHOUSE_PASSWORD;

	return {
		async assertCapacity(plan, caller) {
			assertSingleShard(plan);
			const started = performance.now();
			if (!(await isPairedCurrentBoot(policy))) throw new Error('Paired current admission boot binding changed');
			const before = await filesystem(config.bulkRoot);
			const rows = await select(
				"SELECT path, total_space, free_space, unreserved_space FROM system.disks WHERE name='default' LIMIT 2 FORMAT JSON",
				{}, caller
			);
			if (rows.length !== 1) throw new Error('Paired current capacity disk identity is ambiguous');
			const [after, typed, warehouse] = await Promise.all([
				filesystem(config.bulkRoot),
				filesystem(config.typedOutputRoot),
				filesystem(policy.warehouseMetadataPath)
			]);
			caller.throwIfAborted();
			assertPairedCapacity(policy, config, before, after, typed, warehouse,
				rows[0], performance.now() - started);
		},
		async pendingPublication(plan, caller) {
			assertSingleShard(plan);
			caller.throwIfAborted();
			const started = performance.now();
			if (!(await isPairedCurrentBoot(policy))) throw new Error('Paired current admission boot binding changed');
			const source = await readCurrentSourcePublication(dataSource, plan);
			caller.throwIfAborted();
			if (performance.now() - started > maximumEvidenceAgeMs)
				throw new Error('Current source publication evidence expired');
			if (source === null) return 'not-captured';
			const rows = await select(
				`SELECT toString(batch_id) AS id, toString(source_sha256) AS digest,
					start_ledger, end_ledger, ledger_count, status, projection_contract,
					expected_dataset_rows AS datasets
				FROM "${database}"._ingestion_batches FINAL WHERE batch_id={batch:UUID} LIMIT 2 FORMAT JSON`,
				{ batch: source.id }, caller
			);
			caller.throwIfAborted();
			if (performance.now() - started > maximumEvidenceAgeMs)
				throw new Error('Current publication evidence expired');
			return rows.length !== 1 || !matchesFullPublication(rows[0], source)
				? 'waiting' : 'published';
		}
	};

	async function select(
		query: string, parameters: Readonly<Record<string, string>>, caller: AbortSignal
	): Promise<readonly unknown[]> {
		const url = new URL(endpoint);
		url.search = new URLSearchParams({
			readonly: '1', max_execution_time: '2', max_threads: '1', max_result_rows: '2',
			result_overflow_mode: 'throw', max_rows_to_read: '131072',
			max_memory_usage: '33554432', output_format_json_quote_64bit_integers: '1'
		}).toString();
		for (const [key, value] of Object.entries(parameters)) url.searchParams.set('param_' + key, value);
		const signal = AbortSignal.any([caller, AbortSignal.timeout(3_000)]);
		try {
			const response = await fetch(url, {
				method: 'POST', headers, body: query, signal, cache: 'no-store', redirect: 'error'
			});
			if (!response.ok || (response.headers.get('x-clickhouse-exception-code') ?? '0') !== '0') {
				await response.body?.cancel();
				throw new Error();
			}
			const body = record(await boundedJson(response));
			signal.throwIfAborted();
			if (Object.hasOwn(body, 'exception') || !Array.isArray(body.data) ||
				body.data.length > 2 || body.rows !== body.data.length) throw new Error();
			return body.data;
		} catch {
			// Do not expose driver errors, query payloads, endpoints, or credentials in source logs.
			throw new Error('Paired current warehouse metadata unavailable');
		}
	}
}

export async function isPairedCurrentBoot(policy: PairedCurrentAdmissionPolicy): Promise<boolean> {
	return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() === policy.bootId;
}

export async function settlePairedPendingPublication(
	paired: PairedCurrentAdmission,
	plan: PendingPlan,
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies
): Promise<boolean> {
	const status = await paired.pendingPublication(plan, dependencies.signal);
	dependencies.signal.throwIfAborted();
	if (status === 'not-captured') return false;
	if (status === 'published') {
		await dependencies.pendingPlans.clear();
		return true;
	}
	const retryInMilliseconds = Math.max(30_000, config.admissionRetryMilliseconds);
	dependencies.emit({
		at: new Date(dependencies.now()).toISOString(), event: 'cycle-error',
		message: 'Waiting for exact current source publication in all twenty datasets',
		retryInMilliseconds
	});
	await dependencies.wait(retryInMilliseconds, dependencies.signal);
	return true;
}

export function assertPairedCapacity(
	policy: PairedCurrentAdmissionPolicy, config: AdmissionConfig,
	before: PairedFilesystem, after: PairedFilesystem, typed: PairedFilesystem,
	warehouse: PairedFilesystem, warehouseRow: unknown, elapsedMs: number
): void {
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > maximumEvidenceAgeMs)
		throw new Error('Paired current capacity evidence expired');
	const row = record(warehouseRow);
	const total = positiveUint(row.total_space);
	const free = uint(row.free_space);
	const unreserved = uint(row.unreserved_space);
	if ((row.path !== policy.warehouseReportedPath && row.path !== policy.warehouseReportedPath + '/') ||
		before.inode !== after.inode || warehouse.inode !== policy.warehouseMetadataInode ||
		[before, after, typed, warehouse].some((f) =>
			f.device !== before.device || f.total !== total || f.available < 0n || f.available > total
		) || unreserved > free || free > total) {
		throw new Error('Paired current capacity identity or accounting mismatch');
	}
	const physical = [before.available, after.available, typed.available, warehouse.available, free]
		.reduce((minimum, bytes) => bytes < minimum ? bytes : minimum);
	const paired = physical - (free - unreserved);
	const bps = BigInt(Math.max(500, config.minimumFreeBasisPoints));
	const ratioFloor = (total * bps + 9_999n) / 10_000n;
	const sourceFloor = ratioFloor > config.currentMinimumFreeBytes
		? ratioFloor : config.currentMinimumFreeBytes;
	if (policy.minimumUnreservedBytes < sourceFloor + config.sourceOutputBytes)
		throw new Error('Paired current minimum must cover the source floor and full cycle output');
	if (paired < policy.minimumUnreservedBytes)
		throw new Error('Paired current free-space reserve refused allocation');
}

export function matchesFullPublication(
	value: unknown, source: { id: string; digest: string; start: number; end: number }
): boolean {
	try {
		const row = record(value);
		const counts = record(row.datasets);
		return row.id === source.id && row.digest === source.digest && row.status === 'complete' &&
			row.projection_contract === 'hubble-full20-v1' &&
			uint(row.start_ledger) === BigInt(source.start) &&
			uint(row.end_ledger) === BigInt(source.end) &&
			uint(row.ledger_count) === BigInt(source.end - source.start + 1) &&
			Object.keys(counts).length === datasets.length &&
			uint(counts.history_ledgers) === BigInt(source.end - source.start + 1) &&
			datasets.every((name) => Object.hasOwn(counts, name) && uint(counts[name]) >= 0n);
	} catch {
		return false;
	}
}

async function filesystem(path: string): Promise<PairedFilesystem> {
	const before = await lstat(path, { bigint: true });
	const capacity = await statfs(path, { bigint: true });
	const after = await lstat(path, { bigint: true });
	if (!before.isDirectory() || !after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino)
		throw new Error('Paired current filesystem changed during observation');
	return {
		device: before.dev, inode: before.ino, total: capacity.blocks * capacity.bsize,
		available: capacity.bavail * capacity.bsize
	};
}

async function boundedJson(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (reader === undefined) throw new Error();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 16_384) {
				await reader.cancel();
				throw new Error();
			}
			chunks.push(value);
		}
		return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
	} finally {
		reader.releaseLock();
	}
}

function assertSingleShard(plan: PendingPlan): void {
	if (plan.kind !== 'priority' || plan.shards.length !== 1 ||
		plan.shards[0]?.startLedger !== plan.startLedger || plan.shards[0]?.endLedger !== plan.endLedger) {
		throw new Error('Paired current admission requires one exact priority shard');
	}
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid paired current metadata');
	return value as Record<string, unknown>;
}

function canonicalPath(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith('/') && isAbsolute(value) &&
		value !== '/' && !value.endsWith('/') && !/[\x00-\x20\\]/.test(value) &&
		value.split('/').slice(1).every((part) => part !== '' && part !== '.' && part !== '..') &&
		normalize(value).replaceAll('\\', '/') === value;
}

function uint(value: unknown): bigint {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
	if (typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)) {
		const parsed = BigInt(value);
		if (parsed <= 0xffff_ffff_ffff_ffffn) return parsed;
	}
	throw new Error('Invalid paired current numeric metadata');
}

function positiveUint(value: unknown): bigint {
	const parsed = uint(value);
	if (parsed === 0n) throw new Error('Invalid paired current positive numeric metadata');
	return parsed;
}
