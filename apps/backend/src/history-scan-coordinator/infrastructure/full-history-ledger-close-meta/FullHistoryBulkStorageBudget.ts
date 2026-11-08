import { statfs } from 'node:fs/promises';
import {
	isFullHistoryCurrentCapacityAllowanceActive,
	type FullHistoryCurrentCapacityAllowance
} from './FullHistoryCurrentCapacityAllowance.js';

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
	readonly currentCapacityAllowance?: FullHistoryCurrentCapacityAllowance;
	readonly capacityReader?: FullHistoryBulkStorageCapacityReader;
	readonly maximumStoredBytes: bigint;
	readonly minimumFreeBasisPoints: number;
	readonly minimumFreeBytes: bigint;
	readonly rootPath: string;
	readonly usageReader: FullHistoryBulkStorageUsageReader;
	readonly now?: () => number;
}

export interface FullHistoryBulkStorageAllocation {
	readonly kind: 'priority' | 'historical';
	readonly startLedger: number;
	readonly endLedger: number;
}

export interface FullHistoryBulkStorageBudgetPort {
	assertCanAllocate(byteCount: bigint, allocation?: FullHistoryBulkStorageAllocation): Promise<void>;
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
	readonly #currentCapacityAllowance: FullHistoryCurrentCapacityAllowance | undefined;
	readonly #now: () => number;

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
		this.#currentCapacityAllowance = options.currentCapacityAllowance;
		this.#now = options.now ?? Date.now;
		const allowance = this.#currentCapacityAllowance;
		if (allowance !== undefined &&
			(!Number.isSafeInteger(allowance.minimumLedger) || allowance.minimumLedger < 1 ||
				allowance.minimumLedger > 0xffff_ffff ||
				typeof allowance.maximumReserveBorrowBytes !== 'bigint' ||
				allowance.maximumReserveBorrowBytes <= 0n || allowance.maximumReserveBorrowBytes > 1_024n ** 4n ||
				!Number.isSafeInteger(allowance.expiresAtMilliseconds) || allowance.expiresAtMilliseconds <= 0)) {
			throw new RangeError('Invalid current capacity allowance');
		}
	}

	async assertCanAllocate(byteCount: bigint, allocation?: FullHistoryBulkStorageAllocation): Promise<void> {
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
		let reserve =
			proportionalReserve > this.#minimumFreeBytes
				? proportionalReserve
				: this.#minimumFreeBytes;
		const allowance = this.#currentCapacityAllowance;
		if (allowance !== undefined &&
			isFullHistoryCurrentCapacityAllowanceActive(allowance, this.#now()) &&
			allocation?.kind === 'priority' &&
			Number.isSafeInteger(allocation.startLedger) &&
			Number.isSafeInteger(allocation.endLedger) &&
			allocation.startLedger >= allowance.minimumLedger &&
			allocation.endLedger >= allocation.startLedger && allocation.endLedger <= 0xffff_ffff) {
			// A single shared reserve-floor drawdown, never a per-job credit or a write quota.
			const borrowedFloor = this.#minimumFreeBytes > allowance.maximumReserveBorrowBytes
				? this.#minimumFreeBytes - allowance.maximumReserveBorrowBytes : 0n;
			const hardRatio = this.#minimumFreeBasisPoints > 500n ? this.#minimumFreeBasisPoints : 500n;
			const hardFloor = (capacity.totalBytes * hardRatio + 9_999n) / 10_000n;
			reserve = borrowedFloor > hardFloor ? borrowedFloor : hardFloor;
		}
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
