export interface RegisteredOutputInventorySnapshot {
	storedBytes: bigint;
	registeredDirectories: ReadonlySet<string>;
	registeredCount: number;
}

export interface RegisteredOutputInventoryReader {
	read(): Promise<RegisteredOutputInventorySnapshot>;
}

export interface RegisteredOutputQueryRunner {
	connect(): Promise<unknown>;
	startTransaction(isolation: 'REPEATABLE READ'): Promise<void>;
	query(sql: string): Promise<unknown>;
	commitTransaction(): Promise<void>;
	rollbackTransaction(): Promise<void>;
	release(): Promise<void>;
}

export interface RegisteredOutputDataSource {
	createQueryRunner(): RegisteredOutputQueryRunner;
}

const maximumDatasetRows = 1_000_000;
const maximumCanonicalRows = 200_000;
const directoryAllowanceBytes = 4n * 1024n * 1024n;

const metadataSql = `with capped as materialized (
	select dataset, storage_key, output_bytes, network_passphrase_hash
	from full_history_ledger_close_meta_dataset limit 1000001
)
select count(*)::text as dataset_count,
	coalesce(sum(output_bytes),0)::text as dataset_bytes,
	count(*) filter (where dataset='ledger-close-meta')::text as canonical_count,
	coalesce(sum(output_bytes) filter (where dataset='ledger-close-meta'),0)::text as canonical_bytes,
	(select coalesce(jsonb_agg(jsonb_build_object(
		'storageKey',storage_key,'outputBytes',output_bytes::text,
		'networkHash',encode(network_passphrase_hash,'hex'))),'[]'::jsonb)
	from (select storage_key,output_bytes,network_passphrase_hash
		from capped where dataset='ledger-close-meta' limit 200001) canonical
	) as canonical_rows
from capped`;

const rollupSql = `select
	coalesce(sum(batch_count),0)::text as dataset_count,
	coalesce(sum(output_bytes),0)::text as dataset_bytes,
	coalesce(sum(batch_count) filter (where dataset='ledger-close-meta'),0)::text as canonical_count,
	coalesce(sum(output_bytes) filter (where dataset='ledger-close-meta'),0)::text as canonical_bytes
from full_history_lcm_dataset_status_rollup`;

export class TypeOrmRegisteredOutputInventory implements RegisteredOutputInventoryReader {
	constructor(private readonly dataSource: RegisteredOutputDataSource) {}

	async read(): Promise<RegisteredOutputInventorySnapshot> {
		const runner = this.dataSource.createQueryRunner();
		let transactionStarted = false;
		let failure: unknown;
		let failed = false;
		let inventory: RegisteredOutputInventorySnapshot | undefined;
		try {
			await runner.connect();
			await runner.startTransaction('REPEATABLE READ');
			transactionStarted = true;
			await runner.query('SET TRANSACTION READ ONLY');
			await runner.query("SET LOCAL statement_timeout='120s'");
			await runner.query("SET LOCAL lock_timeout='1s'");
			await runner.query('SET LOCAL max_parallel_workers_per_gather=0');
			await runner.query("SET LOCAL work_mem='512MB'");
			const rollup = aggregate(await runner.query(rollupSql));
			if (rollup.count > BigInt(maximumDatasetRows) ||
				rollup.canonicalCount > BigInt(maximumCanonicalRows)) {
				throw new Error('Registered-output rollup row limit exceeded');
			}
			const metadata = await runner.query(metadataSql);
			const actual = aggregate(metadata);
			if (actual.count > BigInt(maximumDatasetRows)) {
				throw new Error('Registered-output metadata row limit exceeded');
			}
			if (actual.canonicalCount > BigInt(maximumCanonicalRows)) {
				throw new Error('Registered-output canonical row limit exceeded');
			}
			const canonical = rows(record(rows(metadata)[0]).canonical_rows);
			if (canonical.length > maximumCanonicalRows ||
				BigInt(canonical.length) !== actual.canonicalCount) {
				throw new Error('Registered-output canonical count mismatch');
			}
			const directories = new Set<string>();
			let canonicalBytes = 0n;
			for (const value of canonical) {
				const row = record(value);
				directories.add(directoryFor(row));
				canonicalBytes += nonnegativeInteger(row.outputBytes);
			}
			if (directories.size !== canonical.length ||
				canonicalBytes !== actual.canonicalBytes) {
				throw new Error('Registered-output canonical metadata mismatch');
			}
			if (!equalAggregate(actual, rollup)) {
				throw new Error('Registered-output metadata and rollup mismatch');
			}
			inventory = {
				storedBytes: actual.bytes + directoryAllowanceBytes * actual.canonicalCount,
				registeredDirectories: directories,
				registeredCount: canonical.length
			};
			await runner.commitTransaction();
			transactionStarted = false;
		} catch (error) {
			failed = true;
			failure = error;
			if (transactionStarted) {
				try {
					await runner.rollbackTransaction();
				} catch (rollbackError) {
					failure = new AggregateError([error, rollbackError], 'Registered-output read and rollback failed');
				}
			}
		} finally {
			try {
				await runner.release();
			} catch (releaseError) {
				failure = failed ? new AggregateError([failure, releaseError], 'Registered-output read and release failed') : releaseError;
				failed = true;
			}
		}
		if (failed) throw failure;
		if (inventory === undefined) throw new Error('Registered-output read did not complete');
		return inventory;
	}
}

interface Aggregate {
	count: bigint;
	bytes: bigint;
	canonicalCount: bigint;
	canonicalBytes: bigint;
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('Invalid registered-output metadata row');
	}
	return value as Record<string, unknown>;
}

function rows(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new TypeError('Invalid registered-output metadata result');
	}
	return value;
}

function nonnegativeInteger(value: unknown): bigint {
	if (typeof value === 'bigint' && value >= 0n) return value;
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
		return BigInt(value);
	}
	if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
		return BigInt(value);
	}
	throw new TypeError('Invalid registered-output metadata integer');
}

function aggregate(value: unknown): Aggregate {
	const result = rows(value);
	if (result.length !== 1) {
		throw new Error('Registered-output aggregate must contain exactly one row');
	}
	const row = record(result[0]);
	return {
		count: nonnegativeInteger(row.dataset_count),
		bytes: nonnegativeInteger(row.dataset_bytes),
		canonicalCount: nonnegativeInteger(row.canonical_count),
		canonicalBytes: nonnegativeInteger(row.canonical_bytes)
	};
}

function equalAggregate(actual: Aggregate, rollup: Aggregate): boolean {
	return actual.count === rollup.count && actual.bytes === rollup.bytes &&
		actual.canonicalCount === rollup.canonicalCount &&
		actual.canonicalBytes === rollup.canonicalBytes;
}

function directoryFor(row: Record<string, unknown>): string {
	if (typeof row.storageKey !== 'string' || typeof row.networkHash !== 'string') {
		throw new TypeError('Invalid registered-output storage identity');
	}
	const match = /^([0-9a-f]{64})\/ledger-close-meta\/([1-9][0-9]*)-([1-9][0-9]*)\/ledger-close-meta\.xdr\.zst$/.exec(row.storageKey);
	if (match === null || match[1] !== row.networkHash ||
		match[2] === undefined || match[3] === undefined ||
		match[2].length > 10 || match[3].length > 10) {
		throw new Error('Invalid registered-output storage key');
	}
	const start = nonnegativeInteger(match[2]);
	const end = nonnegativeInteger(match[3]);
	if (end < start || end > 4_294_967_295n) {
		throw new Error('Invalid registered-output ledger range');
	}
	return `${match[1]}/ledger-close-meta/${match[2]}-${match[3]}`;
}
