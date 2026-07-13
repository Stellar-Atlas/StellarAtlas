import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import type { NetworkSearchInventoryLoader } from '../NetworkSearchInventoryLoader.js';
import {
	NetworkSearchProjectionRefresher,
	networkSearchProjectionRefreshIntervalMs
} from '../NetworkSearchProjectionRefresher.js';
import type { NetworkSearchService } from '../NetworkSearchService.js';
import type { NetworkSearchInventory } from '../NetworkSearchTypes.js';

type InventoryLoader = Pick<NetworkSearchInventoryLoader, 'load'>;
type ProjectionWriter = Pick<NetworkSearchService, 'refreshProjection'>;

describe('NetworkSearchProjectionRefresher', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it('starts only the enabled writer without an HTTP request', async () => {
		jest.useFakeTimers();
		const inventory = createInventory();
		const writerLoader = mock<InventoryLoader>();
		const readerLoader = mock<InventoryLoader>();
		const writer = mock<ProjectionWriter>();
		const reader = mock<ProjectionWriter>();
		writerLoader.load.mockResolvedValue(ok(inventory));
		readerLoader.load.mockResolvedValue(ok(inventory));
		writer.refreshProjection.mockResolvedValue(undefined);
		reader.refreshProjection.mockResolvedValue(undefined);
		const writerRefresh = new NetworkSearchProjectionRefresher(
			writerLoader,
			writer,
			undefined,
			{ enabled: true }
		);
		const readerRefresh = new NetworkSearchProjectionRefresher(
			readerLoader,
			reader,
			undefined,
			{ enabled: false }
		);

		writerRefresh.start();
		readerRefresh.start();
		await jest.advanceTimersByTimeAsync(0);

		expect(writerLoader.load).toHaveBeenCalledTimes(1);
		expect(writer.refreshProjection).toHaveBeenCalledWith(inventory);
		expect(readerLoader.load).not.toHaveBeenCalled();
		expect(reader.refreshProjection).not.toHaveBeenCalled();

		writerRefresh.stop();
		readerRefresh.stop();
		await jest.advanceTimersByTimeAsync(
			networkSearchProjectionRefreshIntervalMs * 2
		);
		expect(writerLoader.load).toHaveBeenCalledTimes(1);
	});

	it('waits for a projection write before scheduling the next interval', async () => {
		jest.useFakeTimers();
		const loader = mock<InventoryLoader>();
		const writer = mock<ProjectionWriter>();
		let resolveWrite: (() => void) | undefined;
		loader.load.mockResolvedValue(ok(createInventory()));
		writer.refreshProjection.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveWrite = resolve;
			})
		);
		const refresher = new NetworkSearchProjectionRefresher(
			loader,
			writer,
			undefined,
			{ enabled: true, refreshIntervalMs: 10 }
		);

		refresher.start();
		await jest.advanceTimersByTimeAsync(0);
		await jest.advanceTimersByTimeAsync(100);

		expect(loader.load).toHaveBeenCalledTimes(1);
		expect(writer.refreshProjection).toHaveBeenCalledTimes(1);
		if (!resolveWrite)
			throw new Error('Expected the projection write to start');
		resolveWrite();
		await Promise.resolve();
		await jest.advanceTimersByTimeAsync(9);
		expect(loader.load).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(1);
		expect(loader.load).toHaveBeenCalledTimes(2);

		refresher.stop();
		await jest.advanceTimersByTimeAsync(100);
		expect(loader.load).toHaveBeenCalledTimes(2);
	});
});

function createInventory(): NetworkSearchInventory {
	const network = createDummyNetworkV1([], []);
	return {
		archiveRoots: [],
		generatedAt: network.time,
		network,
		nodes: [],
		organizations: []
	};
}
