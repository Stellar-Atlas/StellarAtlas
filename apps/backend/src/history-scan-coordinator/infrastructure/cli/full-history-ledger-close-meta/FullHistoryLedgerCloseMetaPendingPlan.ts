import { constants as fsConstants, linkSync, lstatSync, unlinkSync, type BigIntStats } from 'node:fs';
import {
	open,
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
	installVerified(plan: PendingPlan, assertHeld: PendingPlanGate): Promise<PendingPlan>;
	confirmRecorded(plan: PendingPlan, assertHeld: PendingPlanGate): Promise<void | (() => void)>;
	clear(): Promise<void>;
	clearVerified(plan: PendingPlan, assertHeld: () => Promise<void>): Promise<void>;
	installScopedAttempt(permitId: string, plan: PendingPlan, assertHeld: () => Promise<void>): Promise<PendingPlan>;
	matchesConsumedScopedAttempt(permitId: string, plan: PendingPlan): boolean;
}

type PendingPlanGate = () => Promise<void | (() => void)>;

export class PendingPlanChangedError extends Error {
	constructor(message = 'Verified pending plan changed or could not be identified; refusing to clear it') {
		super(message);
	}
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
	readonly #observed = new WeakMap<PendingPlan, BigIntStats>();

	constructor(private readonly file: string) {}

	async read(): Promise<PendingPlan | null> {
		const { O_NOFOLLOW, O_NONBLOCK } = fsConstants;
		if (O_NOFOLLOW === undefined || O_NONBLOCK === undefined) {
			throw new Error('Pending plan requires safe non-symlink file opening');
		}

		let handle: FileHandle | undefined;
		try {
			handle = await open(this.file, fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
			const opened = await handle.stat({ bigint: true });
			if (!opened.isFile() || opened.size > BigInt(MAX_FILE_BYTES)) {
				throw new Error('Pending plan must be a bounded regular file');
			}
			const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
			let length = 0;
			while (length < buffer.length) {
				const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
				if (bytesRead === 0) break;
				length += bytesRead;
			}
			if (length > MAX_FILE_BYTES) {
				throw new Error('Pending plan file exceeds its bounded size limit');
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(buffer.toString('utf8', 0, length));
			} catch {
				throw new Error('Pending plan file contains invalid JSON');
			}
			const plan = validatePendingPlan(parsed);
			this.#observed.set(plan, opened);
			return plan;
		} catch (error) {
			if (isCode(error, 'ENOENT')) return null;
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

	async installVerified(plan: PendingPlan, assertHeld: PendingPlanGate): Promise<PendingPlan> {
		return this.#installVerified(plan, assertHeld);
	}

	async installScopedAttempt(permitId: string, plan: PendingPlan, assertHeld: () => Promise<void>): Promise<PendingPlan> {
		if (!isCanonicalUuid(permitId)) throw new Error('Scoped attempt permit ID must be a canonical UUID');
		const installed = await this.#installVerified(plan, assertHeld, `${this.file}.${permitId}.spent`);
		if (!this.matchesConsumedScopedAttempt(permitId, installed)) {
			throw new PendingPlanChangedError('Scoped pending plan lost its spent-inode binding; preserved');
		}
		return installed;
	}

	async #installVerified(plan: PendingPlan, assertHeld: PendingPlanGate, spent?: string): Promise<PendingPlan> {
		const validated = validatePendingPlan(plan);
		const directory = dirname(this.file);
		const temporary = join(directory, `.${basename(this.file)}.${process.pid}.${randomUUID()}.tmp`);
		let handle: FileHandle | undefined;
		let installed = false;
		let staged: BigIntStats | undefined;
		try {
			handle = await open(temporary, 'wx', 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(validated)}\n`, 'utf8');
				await handle.sync();
				staged = await handle.stat({ bigint: true });
			} finally {
				await handle.close();
			}
			let assertReady = await assertHeld();
			if (spent !== undefined) {
				try {
					// The spent name and the authoritative plan must reference this same inode.
					linkSync(temporary, spent);
					await syncDirectory(directory);
				} catch {
					throw new PendingPlanChangedError('Scoped current attempt is spent or could not be made durable');
				}
				assertReady = await assertHeld();
			}
			// The complete inode becomes visible atomically. No await or replacing rename here.
			assertReady?.();
			try {
				linkSync(temporary, this.file);
				installed = true;
			} catch (error) {
				if (isCode(error, 'EEXIST')) {
					throw new PendingPlanChangedError('Pending plan appeared before installation; refusing to replace it');
				}
				throw error;
			}
		} finally {
			if (handle !== undefined) await unlink(temporary).catch((error: unknown) => {
				if (isCode(error, 'ENOENT')) return;
				if (installed) throw new PendingPlanChangedError('Pending plan installation could not be made durable');
				throw error;
			});
		}
		try {
			await syncDirectory(directory);
		} catch {
			// The name may already be durable. Preserve it for the next owner to inspect.
			throw new PendingPlanChangedError('Pending plan installation could not be made durable');
		}
		const changed = () => new PendingPlanChangedError('Pending plan changed during verified installation; preserved');
		let named: BigIntStats;
		try {
			named = lstatSync(this.file, { bigint: true });
		} catch {
			throw changed();
		}
		// Linking and removing the temporary name change ctime, not contents.
		if (staged === undefined || !named.isFile() || staged.dev !== named.dev || staged.ino !== named.ino ||
			staged.size !== named.size || staged.mtimeNs !== named.mtimeNs) throw changed();
		this.#observed.set(validated, named);
		return validated;
	}

	async confirmRecorded(plan: PendingPlan, assertHeld: PendingPlanGate): Promise<void | (() => void)> {
		const observed = this.#observed.get(plan);
		const changed = () => new PendingPlanChangedError('Recorded pending plan changed or could not be identified; refusing to resume');
		if (observed === undefined) throw changed();
		const current = await this.read().catch(() => { throw changed(); });
		const currentFile = current === null ? undefined : this.#observed.get(current);
		if (current === null || currentFile === undefined || !samePlan(plan, current) ||
			!sameFileVersion(observed, currentFile)) throw changed();

		const assertNamed = (): void => {
			let named: BigIntStats;
			try {
				named = lstatSync(this.file, { bigint: true });
			} catch {
				throw changed();
			}
			if (!sameFileVersion(observed, named)) throw changed();
		};
		assertNamed();
		try {
			await syncDirectory(dirname(this.file));
		} catch {
			throw new PendingPlanChangedError('Recorded pending plan durability could not be confirmed');
		}
		const assertReady = await assertHeld();
		// Recheck the original name synchronously after the fsync and lease awaits.
		assertNamed();
		if (assertReady !== undefined) {
			assertReady();
			return () => {
				assertNamed();
				assertReady();
			};
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

	async clearVerified(plan: PendingPlan, assertHeld: () => Promise<void>): Promise<void> {
		const observed = this.#observed.get(plan);
		const current = await this.read().catch(() => { throw new PendingPlanChangedError(); });
		const currentFile = current === null ? undefined : this.#observed.get(current);
		if (observed === undefined || current === null || currentFile === undefined ||
			!samePlan(plan, current) || !sameFileVersion(observed, currentFile)) {
			throw new PendingPlanChangedError();
		}
		await assertHeld();
		// No await between the last pathname identity check and the unlink.
		let named: BigIntStats;
		try {
			named = lstatSync(this.file, { bigint: true });
		} catch {
			throw new PendingPlanChangedError();
		}
		if (!sameFileVersion(observed, named)) throw new PendingPlanChangedError();
		try {
			unlinkSync(this.file);
			await syncDirectory(dirname(this.file));
		} catch {
			throw new PendingPlanChangedError('Verified pending plan clear could not be made durable');
		}
	}

	matchesConsumedScopedAttempt(permitId: string, plan: PendingPlan): boolean {
		const observed = this.#observed.get(plan);
		if (!isCanonicalUuid(permitId) || observed === undefined) return false;
		try {
			const spent = lstatSync(`${this.file}.${permitId}.spent`, { bigint: true });
			const named = lstatSync(this.file, { bigint: true });
			return spent.nlink >= 2n && sameFileVersion(observed, spent) && sameFileVersion(observed, named);
		} catch {
			return false;
		}
	}
}

function isCanonicalUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function sameFileVersion(expected: BigIntStats, observed: BigIntStats): boolean {
	return observed.isFile() && expected.dev === observed.dev && expected.ino === observed.ino &&
		expected.size === observed.size && expected.mtimeNs === observed.mtimeNs &&
		expected.ctimeNs === observed.ctimeNs;
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
