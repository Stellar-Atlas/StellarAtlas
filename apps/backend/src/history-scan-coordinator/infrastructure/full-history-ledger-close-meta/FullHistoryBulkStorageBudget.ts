import { statfs } from 'node:fs/promises';

export interface FullHistoryBulkStorageCapacity {
	readonly availableBytes: bigint;
	readonly totalBytes: bigint;
}

export interface FullHistoryBulkStorageCapacityReader {
	readCapacity(rootPath: string): Promise<FullHistoryBulkStorageCapacity>;
}

export interface FullHistoryBulkStorageUsageReader {
	readStoredBytes(): Promise<bigint>;
}

export interface FullHistoryBulkStorageBudgetOptions {
	readonly capacityReader?: FullHistoryBulkStorageCapacityReader;
	readonly maximumStoredBytes: bigint;
	readonly minimumFreeBasisPoints: number;
	readonly minimumFreeBytes: bigint;
	readonly rootPath: string;
	readonly usageReader: FullHistoryBulkStorageUsageReader;
}

export interface FullHistoryBulkStorageBudgetPort {
	assertCanAllocate(byteCount: bigint): Promise<void>;
}

export class FullHistoryBulkStorageBudgetExceededError extends Error {
	constructor(readonly reason: 'free-space-reserve' | 'store-size-limit') {
		super(`Full-history storage budget rejected allocation: ${reason}`);
		this.name = 'FullHistoryBulkStorageBudgetExceededError';
	}
}

export class FullHistoryBulkStorageBudget implements FullHistoryBulkStorageBudgetPort {
	readonly #capacityReader: FullHistoryBulkStorageCapacityReader;
	readonly #maximumStoredBytes: bigint;
	readonly #minimumFreeBasisPoints: bigint;
	readonly #minimumFreeBytes: bigint;
	readonly #rootPath: string;
	readonly #usageReader: FullHistoryBulkStorageUsageReader;

	constructor(options: FullHistoryBulkStorageBudgetOptions) {
		assertAbsolutePath(options.rootPath);
		assertPositive(options.maximumStoredBytes, 'maximumStoredBytes');
		assertNonNegative(options.minimumFreeBytes, 'minimumFreeBytes');
		if (
			!Number.isSafeInteger(options.minimumFreeBasisPoints) ||
			options.minimumFreeBasisPoints < 0 ||
			options.minimumFreeBasisPoints > 10_000
		) {
			throw new RangeError(
				'minimumFreeBasisPoints must be an integer between 0 and 10000'
			);
		}
		this.#capacityReader = options.capacityReader ?? fileSystemCapacityReader;
		this.#maximumStoredBytes = options.maximumStoredBytes;
		this.#minimumFreeBasisPoints = BigInt(options.minimumFreeBasisPoints);
		this.#minimumFreeBytes = options.minimumFreeBytes;
		this.#rootPath = options.rootPath;
		this.#usageReader = options.usageReader;
	}

	async assertCanAllocate(byteCount: bigint): Promise<void> {
		assertPositive(byteCount, 'byteCount');
		const [capacity, storedBytes] = await Promise.all([
			this.#capacityReader.readCapacity(this.#rootPath),
			this.#usageReader.readStoredBytes()
		]);
		assertCapacity(capacity);
		assertNonNegative(storedBytes, 'storedBytes');
		if (storedBytes + byteCount > this.#maximumStoredBytes) {
			throw new FullHistoryBulkStorageBudgetExceededError('store-size-limit');
		}
		const proportionalReserve =
			(capacity.totalBytes * this.#minimumFreeBasisPoints + 9_999n) / 10_000n;
		const reserve =
			proportionalReserve > this.#minimumFreeBytes
				? proportionalReserve
				: this.#minimumFreeBytes;
		if (capacity.availableBytes < byteCount + reserve) {
			throw new FullHistoryBulkStorageBudgetExceededError('free-space-reserve');
		}
	}
}

const fileSystemCapacityReader: FullHistoryBulkStorageCapacityReader = {
	async readCapacity(rootPath) {
		const value = await statfs(rootPath, { bigint: true });
		return {
			availableBytes: value.bavail * value.bsize,
			totalBytes: value.blocks * value.bsize
		};
	}
};

function assertAbsolutePath(value: string): void {
	if (!value.startsWith('/')) {
		throw new TypeError('rootPath must be an absolute filesystem path');
	}
}

function assertCapacity(capacity: FullHistoryBulkStorageCapacity): void {
	assertPositive(capacity.totalBytes, 'totalBytes');
	assertNonNegative(capacity.availableBytes, 'availableBytes');
	if (capacity.availableBytes > capacity.totalBytes) {
		throw new RangeError('availableBytes cannot exceed totalBytes');
	}
}

function assertPositive(value: bigint, field: string): void {
	if (value < 1n) throw new RangeError(`${field} must be positive`);
}

function assertNonNegative(value: bigint, field: string): void {
	if (value < 0n) throw new RangeError(`${field} cannot be negative`);
}
