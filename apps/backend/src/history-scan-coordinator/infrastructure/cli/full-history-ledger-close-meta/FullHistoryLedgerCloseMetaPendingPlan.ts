import { constants as fsConstants } from 'node:fs';
import {
	open,
	lstat,
	rename,
	unlink,
	type FileHandle
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, join } from 'node:path';

export interface PendingPlan {
	readonly version: 1;
	readonly kind: 'priority' | 'historical';
	readonly networkPassphraseHash: string;
	readonly sourceId: string;
	readonly configDigest: string;
	readonly partitionVersion: 'source-aligned-remainder-v1';
	readonly sourceBatchLedgerCount: number;
	readonly typedShardLedgerCount: number;
	readonly startLedger: number;
	readonly endLedger: number;
	readonly shards: readonly { readonly startLedger: number; readonly endLedger: number }[];
}

export interface PendingPlanStore {
	read(): Promise<PendingPlan | null>;
	write(plan: PendingPlan): Promise<void>;
	clear(): Promise<void>;
}

const MAX_FILE_BYTES = 131_072;
const MIN_LEDGER_COUNT = 64;
const MAX_LEDGER_COUNT = 65_536;
const PLAN_KEYS = [
	'configDigest',
	'endLedger',
	'kind',
	'networkPassphraseHash',
	'partitionVersion',
	'shards',
	'sourceBatchLedgerCount',
	'sourceId',
	'startLedger',
	'typedShardLedgerCount',
	'version'
] as const;

export class FileFullHistoryLedgerCloseMetaPendingPlan implements PendingPlanStore {
	constructor(private readonly file: string) {}

	async read(): Promise<PendingPlan | null> {
		let metadata;
		try {
			metadata = await lstat(this.file);
		} catch (error) {
			if (isCode(error, 'ENOENT')) return null;
			throw error;
		}
		if (metadata.isSymbolicLink() || !metadata.isFile()) {
			throw new Error('Pending plan must be a regular non-symlink file');
		}
		if (metadata.size > MAX_FILE_BYTES) {
			throw new Error('Pending plan file exceeds its bounded size limit');
		}

		let handle: FileHandle | undefined;
		try {
			const noFollow = fsConstants.O_NOFOLLOW ?? 0;
			handle = await open(this.file, fsConstants.O_RDONLY | noFollow);
			const opened = await handle.stat();
			if (!opened.isFile() || opened.size > MAX_FILE_BYTES) {
				throw new Error('Pending plan must be a bounded regular file');
			}
			const contents = await handle.readFile();
			if (contents.byteLength > MAX_FILE_BYTES) {
				throw new Error('Pending plan file exceeds its bounded size limit');
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(contents.toString('utf8'));
			} catch {
				throw new Error('Pending plan file contains invalid JSON');
			}
			return validatePendingPlan(parsed);
		} catch (error) {
			if (isCode(error, 'ELOOP')) {
				throw new Error('Pending plan must be a regular non-symlink file');
			}
			throw error;
		} finally {
			await handle?.close();
		}
	}

	async write(plan: PendingPlan): Promise<void> {
		const validated = validatePendingPlan(plan);
		const existing = await this.read();
		if (existing !== null) {
			if (samePlan(existing, validated)) {
				await syncDirectory(dirname(this.file));
				return;
			}
			throw new Error('A different pending plan already exists');
		}

		const directory = dirname(this.file);
		const temporary = join(directory, `.${basename(this.file)}.${process.pid}.${randomUUID()}.tmp`);
		let handle: FileHandle | undefined;
		let created = false;
		let renamed = false;
		try {
			handle = await open(temporary, 'wx', 0o600);
			created = true;
			await handle.writeFile(`${JSON.stringify(validated)}\n`, 'utf8');
			await handle.sync();
			await handle.close();
			handle = undefined;
			await rename(temporary, this.file);
			renamed = true;
			await syncDirectory(directory);
		} finally {
			await handle?.close();
			if (created && !renamed) await unlink(temporary).catch((error: unknown) => {
				if (!isCode(error, 'ENOENT')) throw error;
			});
		}
	}

	async clear(): Promise<void> {
		try {
			await unlink(this.file);
		} catch (error) {
			if (isCode(error, 'ENOENT')) return;
			throw error;
		}
		await syncDirectory(dirname(this.file));
	}
}

function validatePendingPlan(value: unknown): PendingPlan {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Pending plan has an invalid shape');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length !== PLAN_KEYS.length || keys.some((key, index) => key !== PLAN_KEYS[index])) {
		throw new Error('Pending plan has an invalid shape');
	}
	if (record.version !== 1 || (record.kind !== 'priority' && record.kind !== 'historical') ||
		record.partitionVersion !== 'source-aligned-remainder-v1') {
		throw new Error('Pending plan has an invalid version or kind');
	}
	if (!isHexDigest(record.networkPassphraseHash) || !isHexDigest(record.configDigest)) {
		throw new Error('Pending plan digests must be 64 hexadecimal characters');
	}
	if (typeof record.sourceId !== 'string' || record.sourceId.length < 1 || record.sourceId.length > 200) {
		throw new Error('Pending plan sourceId must contain 1 to 200 characters');
	}
	for (const [field, candidate] of [
		['sourceBatchLedgerCount', record.sourceBatchLedgerCount],
		['typedShardLedgerCount', record.typedShardLedgerCount],
		['startLedger', record.startLedger],
		['endLedger', record.endLedger]
	] as const) {
		if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 1) {
			throw new Error(`Pending plan ${field} must be a positive safe integer`);
		}
	}
	const startLedger = record.startLedger as number;
	const endLedger = record.endLedger as number;
	const sourceBatchLedgerCount = record.sourceBatchLedgerCount as number;
	const typedShardLedgerCount = record.typedShardLedgerCount as number;
	const count = endLedger - startLedger + 1;
	if (endLedger < startLedger || count < MIN_LEDGER_COUNT || count > MAX_LEDGER_COUNT) {
		throw new Error('Pending plan ledger range must contain 64 to 65536 ledgers');
	}
	if (!Array.isArray(record.shards) || record.shards.length < 1 || record.shards.length > 1_024) {
		throw new Error('Pending plan must contain 1 to 1024 shards');
	}
	let expectedStart = startLedger;
	const shards = record.shards.map((shard, index) => {
		if (shard === null || typeof shard !== 'object' || Array.isArray(shard)) {
			throw new Error(`Pending plan shard ${index} has an invalid shape`);
		}
		const shardRecord = shard as Record<string, unknown>;
		if (Object.keys(shardRecord).sort().join(',') !== 'endLedger,startLedger') {
			throw new Error(`Pending plan shard ${index} has an invalid shape`);
		}
		const shardStart = shardRecord.startLedger;
		const shardEnd = shardRecord.endLedger;
		if (typeof shardStart !== 'number' || !Number.isSafeInteger(shardStart) ||
			typeof shardEnd !== 'number' || !Number.isSafeInteger(shardEnd) ||
			shardStart !== expectedStart || shardEnd < shardStart) {
			throw new Error(`Pending plan shard ${index} is non-contiguous or invalid`);
		}
		const shardCount = shardEnd - shardStart + 1;
		if (shardCount < MIN_LEDGER_COUNT || shardCount > typedShardLedgerCount ||
			shardCount % sourceBatchLedgerCount !== 0) {
			throw new Error(`Pending plan shard ${index} has an invalid size`);
		}
		expectedStart = shardEnd + 1;
		return { startLedger: shardStart, endLedger: shardEnd };
	});
	if (expectedStart !== endLedger + 1) {
		throw new Error('Pending plan shards do not cover the planned ledger range');
	}
	return {
		version: 1,
		kind: record.kind,
		networkPassphraseHash: record.networkPassphraseHash,
		sourceId: record.sourceId,
		configDigest: record.configDigest,
		partitionVersion: 'source-aligned-remainder-v1',
		sourceBatchLedgerCount,
		typedShardLedgerCount,
		startLedger,
		endLedger,
		shards
	};
}

function isHexDigest(value: unknown): value is string {
	return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

function samePlan(left: PendingPlan, right: PendingPlan): boolean {
	return PLAN_KEYS.every((key) => key === 'shards'
		? JSON.stringify(left.shards) === JSON.stringify(right.shards)
		: left[key] === right[key]);
}

function isCode(error: unknown, code: string): boolean {
	return typeof error === 'object' && error !== null && 'code' in error &&
		(error as { code?: unknown }).code === code;
}

async function syncDirectory(directory: string): Promise<void> {
	const handle = await open(directory, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
