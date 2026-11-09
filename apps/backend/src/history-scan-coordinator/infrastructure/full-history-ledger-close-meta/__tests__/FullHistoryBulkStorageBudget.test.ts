import {
	FullHistoryBulkStorageBudget,
	FullHistoryBulkStorageBudgetExceededError,
	type FullHistoryBulkStorageCapacityReader,
	type FullHistoryBulkStorageUsageReader
} from '../FullHistoryBulkStorageBudget.js';

describe('FullHistoryBulkStorageBudget', () => {
	const tebibyte = 1024n ** 4n;
	const capacityReader: FullHistoryBulkStorageCapacityReader = {
		readCapacity: jest.fn(async () => ({
			availableBytes: 47n * tebibyte,
			totalBytes: 51n * tebibyte
		}))
	};
	const usageReader: FullHistoryBulkStorageUsageReader = {
		readStoredBytes: jest.fn(async () => 5n * tebibyte)
	};

	it('accepts an allocation inside both the store and free-space budgets', async () => {
		const budget = createBudget();
		await expect(budget.assertCanAllocate(tebibyte)).resolves.toBeUndefined();
	});

	it('rejects an allocation above the configured store budget', async () => {
		const budget = createBudget({ maximumStoredBytes: 5n * tebibyte });
		await expect(budget.assertCanAllocate(1n)).rejects.toEqual(
			new FullHistoryBulkStorageBudgetExceededError('store-size-limit')
		);
	});

	it('reserves the larger of the absolute and proportional free space', async () => {
		const constrainedCapacity: FullHistoryBulkStorageCapacityReader = {
			readCapacity: jest.fn(async () => ({
				availableBytes: 6n * tebibyte,
				totalBytes: 51n * tebibyte
			}))
		};
		const budget = createBudget({ capacityReader: constrainedCapacity });
		await expect(budget.assertCanAllocate(tebibyte)).rejects.toEqual(
			new FullHistoryBulkStorageBudgetExceededError('free-space-reserve')
		);
	});

	it('allows only eligible priority work to borrow the reserve floor before expiry', async () => {
		const capacityReader = createCapacityReader(3n * tebibyte + tebibyte * 3n / 4n, 60n * tebibyte);
		const allowance = createAllowance();
		const budget = createBudget({
			capacityReader,
			currentCapacityAllowance: allowance,
			minimumFreeBasisPoints: 500,
			minimumFreeBytes: 4n * tebibyte,
			now: () => 1_000
		});
		const priority = { kind: 'priority' as const, startLedger: 1_000, endLedger: 1_063 };
		await expect(budget.assertCanAllocate(8n * 1024n ** 3n, priority)).resolves.toBeUndefined();
		for (const allocation of [
			{ kind: 'historical' as const, startLedger: 1_000, endLedger: 1_063 },
			{ kind: 'priority' as const, startLedger: 999, endLedger: 1_062 },
			undefined
		]) {
			await expect(budget.assertCanAllocate(8n * 1024n ** 3n, allocation)).rejects.toEqual(
				new FullHistoryBulkStorageBudgetExceededError('free-space-reserve')
			);
		}
		const expiredBudget = createBudget({
			capacityReader,
			currentCapacityAllowance: allowance,
			minimumFreeBasisPoints: 500,
			minimumFreeBytes: 4n * tebibyte,
			now: () => 2_000
		});
		await expect(expiredBudget.assertCanAllocate(8n * 1024n ** 3n, priority)).rejects.toEqual(
			new FullHistoryBulkStorageBudgetExceededError('free-space-reserve')
		);
	});

	it('keeps the independent five-percent hard floor and larger ordinary proportional floor', async () => {
		const allowance = createAllowance();
		const priority = { kind: 'priority' as const, startLedger: 1_000, endLedger: 1_063 };
		const outputBytes = 8n * 1024n ** 3n;
		const hardFloorBudget = createBudget({
			capacityReader: createCapacityReader(4n * tebibyte, 100n * tebibyte),
			currentCapacityAllowance: allowance,
			minimumFreeBasisPoints: 0,
			minimumFreeBytes: 4n * tebibyte,
			now: () => 1_000
		});
		await expect(hardFloorBudget.assertCanAllocate(outputBytes, priority)).rejects.toEqual(
			new FullHistoryBulkStorageBudgetExceededError('free-space-reserve')
		);
		const proportionalFloorBudget = createBudget({
			capacityReader: createCapacityReader(9n * tebibyte, 100n * tebibyte),
			currentCapacityAllowance: allowance,
			minimumFreeBasisPoints: 1_000,
			minimumFreeBytes: 4n * tebibyte,
			now: () => 1_000
		});
		await expect(proportionalFloorBudget.assertCanAllocate(outputBytes, priority)).rejects.toEqual(
			new FullHistoryBulkStorageBudgetExceededError('free-space-reserve')
		);
	});

	it('does not let an active allowance bypass the cumulative stored-bytes cap', async () => {
		const budget = createBudget({
			currentCapacityAllowance: createAllowance(),
			maximumStoredBytes: 5n * tebibyte,
			now: () => 1_000
		});
		await expect(
			budget.assertCanAllocate(8n * 1024n ** 3n, {
				kind: 'priority',
				startLedger: 1_000,
				endLedger: 1_063
			})
		).rejects.toEqual(new FullHistoryBulkStorageBudgetExceededError('store-size-limit'));
	});

	it('charges the full output, proportional reserve and store cap only to eligible durable current work', async () => {
		const outputBytes = 8n * 1024n ** 3n;
		const currentOnlyCapacity = { minimumLedger: 1000, minimumFreeBytes: 3n * tebibyte };
		const priority = { kind: 'priority' as const, startLedger: 1000, endLedger: 1063 };
		const floor = (60n * tebibyte * 550n + 9999n) / 10000n;
		const config = {
			currentOnlyCapacity, minimumFreeBasisPoints: 550, minimumFreeBytes: 4n * tebibyte
		};
		// The 5.5% reserve is greater than the separate absolute floor on this fixture.
		const budget = createBudget({
			...config, capacityReader: createCapacityReader(floor + outputBytes, 60n * tebibyte)
		});
		await expect(budget.assertCanAllocate(outputBytes, priority)).resolves.toBeUndefined();
		await expect(budget.assertCanAllocate(outputBytes + 1n, priority)).rejects.toThrow('free-space-reserve');
		for (const allocation of [
			{ ...priority, kind: 'historical' as const }, { ...priority, startLedger: 999 }, undefined
		]) {
			await expect(budget.assertCanAllocate(outputBytes, allocation)).rejects.toThrow('non-current storage');
		}
		await expect(createBudget({ ...config, maximumStoredBytes: 5n * tebibyte })
			.assertCanAllocate(outputBytes, priority)).rejects.toThrow('store-size-limit');
	});

	it('rejects relative roots and invalid reserve ratios', () => {
		expect(() => createBudget({ rootPath: 'relative' })).toThrow(/absolute/);
		expect(() => createBudget({ minimumFreeBasisPoints: 10_001 })).toThrow(
			/between 0 and 10000/
		);
	});

	function createBudget(
		overrides: Partial<
			ConstructorParameters<typeof FullHistoryBulkStorageBudget>[0]
		> = {}
	): FullHistoryBulkStorageBudget {
		return new FullHistoryBulkStorageBudget({
			capacityReader,
			maximumStoredBytes: 12n * tebibyte,
			minimumFreeBasisPoints: 1_000,
			minimumFreeBytes: 5n * tebibyte,
			rootPath: '/bulk/full-history',
			usageReader,
			...overrides
		});
	}

	function createCapacityReader(
		availableBytes: bigint,
		totalBytes: bigint
	): FullHistoryBulkStorageCapacityReader {
		return { readCapacity: jest.fn(async () => ({ availableBytes, totalBytes })) };
	}

	function createAllowance() {
		return Object.freeze({
			minimumLedger: 1_000,
			maximumReserveBorrowBytes: 512n * 1024n ** 3n,
			expiresAtMilliseconds: 2_000
		});
	}
});
