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
});
