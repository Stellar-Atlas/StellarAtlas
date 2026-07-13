import type { Index } from 'meilisearch';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { networkSearchRequiredSettings } from '../NetworkSearchQuery.js';
import { NetworkSearchService } from '../NetworkSearchService.js';
import type {
	NetworkSearchInventory,
	NetworkSearchStoredDocument
} from '../NetworkSearchTypes.js';

describe('NetworkSearchService projection serialization', () => {
	it('finishes the active write before starting a newer inventory write', async () => {
		const harness = createSlowIndex();
		const service = new NetworkSearchService(
			{
				host: 'http://127.0.0.1:7701',
				indexName: 'network_projection_test',
				writable: true
			},
			undefined,
			harness.index
		);

		const first = service.refreshProjection(
			createInventory('2026-07-13T23:00:00.000Z', '63388000')
		);
		await waitUntil(() => harness.pendingWrites.length === 1);
		const second = service.refreshProjection(
			createInventory('2026-07-13T23:01:00.000Z', '63388012')
		);
		await flushMicrotasks();

		expect(harness.addDocuments).toHaveBeenCalledTimes(1);
		harness.pendingWrites[0]?.();
		await waitUntil(() => harness.pendingWrites.length === 2);
		expect(harness.maxActiveWrites()).toBe(1);

		harness.pendingWrites[1]?.();
		await Promise.all([first, second]);
		expect(harness.addDocuments).toHaveBeenCalledTimes(2);
		expect(harness.maxActiveWrites()).toBe(1);
		expect(harness.latestState()?.networkTime).toBe('2026-07-13T23:01:00.000Z');
	});
});

function createInventory(
	time: string,
	latestLedger: string
): NetworkSearchInventory {
	return {
		archiveRoots: [],
		generatedAt: time,
		network: {
			...createDummyNetworkV1([], []),
			latestLedger,
			time
		},
		nodes: [],
		organizations: []
	};
}

function createSlowIndex() {
	let activeWrites = 0;
	let maxActiveWrites = 0;
	let latestDocuments: readonly NetworkSearchStoredDocument[] = [];
	const pendingWrites: Array<() => void> = [];
	const addDocuments = jest.fn(
		(documents: readonly NetworkSearchStoredDocument[]) => ({
			waitTask: jest.fn(async () => {
				activeWrites += 1;
				maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
				await new Promise<void>((resolve) => pendingWrites.push(resolve));
				latestDocuments = documents;
				activeWrites -= 1;
				return { status: 'succeeded' };
			})
		})
	);
	const successfulTask = () => ({
		waitTask: jest.fn(async () => ({ status: 'succeeded' }))
	});
	const index = {
		addDocuments,
		deleteDocuments: jest.fn(successfulTask),
		getSettings: jest.fn(async () => ({
			filterableAttributes: [
				...(networkSearchRequiredSettings.filterableAttributes ?? [])
			],
			searchableAttributes: [
				...(networkSearchRequiredSettings.searchableAttributes ?? [])
			],
			sortableAttributes: [
				...(networkSearchRequiredSettings.sortableAttributes ?? [])
			]
		})),
		updateSettings: jest.fn(successfulTask)
	} as unknown as Index<NetworkSearchStoredDocument>;

	return {
		addDocuments,
		index,
		latestState: () =>
			latestDocuments.find((document) => document.documentKind === 'state'),
		maxActiveWrites: () => maxActiveWrites,
		pendingWrites
	};
}

async function waitUntil(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (condition()) return;
		await flushMicrotasks();
	}
	throw new Error('Projection write did not reach the expected state');
}

async function flushMicrotasks(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
