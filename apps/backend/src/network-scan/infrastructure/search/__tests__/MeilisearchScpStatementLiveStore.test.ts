import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { MeilisearchScpStatementLiveStore } from '../MeilisearchScpStatementLiveStore.js';

describe('MeilisearchScpStatementLiveStore', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('enqueues live SCP documents without waiting for task completion', async () => {
		const { addDocuments, store } = setupStore();

		await store.saveMany([createObservation('11')]);

		expect(addDocuments).toHaveBeenCalledTimes(1);
	});

	it('skips live SCP document writes while the previous task is still pending', async () => {
		const { addDocuments, store } = setupStore();

		await store.saveMany([createObservation('11')]);
		await store.saveMany([createObservation('12')]);

		expect(addDocuments).toHaveBeenCalledTimes(1);
	});

	it('resumes live SCP document writes after the previous task succeeds', async () => {
		const { addDocuments, getTask, store } = setupStore();
		jest
			.spyOn(Date, 'now')
			.mockReturnValueOnce(1_000)
			.mockReturnValueOnce(1_000)
			.mockReturnValueOnce(7_000)
			.mockReturnValueOnce(7_000);
		getTask.mockResolvedValueOnce({
			batchUid: null,
			canceledBy: null,
			duration: 'PT0.01S',
			enqueuedAt: '2026-07-09T00:00:00.000Z',
			error: null,
			finishedAt: '2026-07-09T00:00:00.010Z',
			indexUid: 'scp',
			startedAt: '2026-07-09T00:00:00.001Z',
			status: 'succeeded',
			type: 'documentAdditionOrUpdate',
			uid: 42
		});

		await store.saveMany([createObservation('11')]);
		await store.saveMany([createObservation('12')]);

		expect(getTask).toHaveBeenCalledWith(42);
		expect(addDocuments).toHaveBeenCalledTimes(2);
	});
});

function setupStore() {
	const logger = mock<Logger>();
	const addDocuments = jest.fn(async () => ({
		enqueuedAt: '2026-07-09T00:00:00.000Z',
		indexUid: 'scp',
		status: 'enqueued',
		taskUid: 42,
		type: 'documentAdditionOrUpdate'
	}));
	const getTask = jest.fn();
	const index = {
		addDocuments,
		deleteDocuments: jest.fn(async () => ({
			enqueuedAt: '2026-07-09T00:00:00.000Z',
			indexUid: 'scp',
			status: 'enqueued',
			taskUid: 43,
			type: 'documentDeletion'
		})),
		search: jest.fn(),
		tasks: { getTask },
		updateSettings: jest.fn()
	} as unknown as ConstructorParameters<
		typeof MeilisearchScpStatementLiveStore
	>[2];
	const store = new MeilisearchScpStatementLiveStore(
		{ indexName: 'scp' },
		logger,
		index
	);
	Reflect.set(store, 'indexReady', true);

	return { addDocuments, getTask, logger, store };
}

function createObservation(slotIndex: string): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}
