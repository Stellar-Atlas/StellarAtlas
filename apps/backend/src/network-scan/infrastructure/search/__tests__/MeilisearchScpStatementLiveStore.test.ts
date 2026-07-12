import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { MeilisearchScpStatementLiveStore } from '../MeilisearchScpStatementLiveStore.js';

jest.mock('meilisearch', () => ({ Meilisearch: jest.fn() }));

describe('MeilisearchScpStatementLiveStore', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('enqueues live SCP documents without waiting for task completion', async () => {
		const { addDocuments, store } = setupStore();

		const outcome = await store.saveMany([createObservation('11')]);

		expect(outcome).toEqual({ status: 'accepted', taskPending: true });
		expect(addDocuments).toHaveBeenCalledTimes(1);
	});

	it('skips live SCP document writes while the previous task is still pending', async () => {
		const { addDocuments, store } = setupStore();

		await store.saveMany([createObservation('11')]);
		const outcome = await store.saveMany([createObservation('12')]);

		expect(addDocuments).toHaveBeenCalledTimes(1);
		expect(outcome).toEqual(
			expect.objectContaining({
				reason: 'document-task-pending',
				status: 'deferred'
			})
		);
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

	it('reports an unavailable index as deferred instead of success', async () => {
		const store = new MeilisearchScpStatementLiveStore({ indexName: 'scp' });

		await expect(store.saveMany([createObservation('11')])).resolves.toEqual({
			reason: 'index-unavailable',
			status: 'deferred'
		});
	});

	it('reports a failed document enqueue as deferred with cooldown', async () => {
		const { addDocuments, store } = setupStore();
		addDocuments.mockRejectedValueOnce(new Error('Meili unavailable'));

		const outcome = await store.saveMany([createObservation('11')]);

		expect(outcome).toEqual(
			expect.objectContaining({
				reason: 'document-write-failed',
				status: 'deferred'
			})
		);
	});

	it('reports a final accepted-task failure without requiring another write', async () => {
		const { addDocuments, getTask, store } = setupStore();
		await store.saveMany([createObservation('11')]);
		Reflect.set(store, 'pendingDocumentTaskCheckedAtMs', 0);
		getTask.mockResolvedValueOnce({
			batchUid: null,
			canceledBy: null,
			duration: 'PT0.01S',
			enqueuedAt: '2026-07-09T00:00:00.000Z',
			error: { message: 'index failed' },
			finishedAt: '2026-07-09T00:00:00.010Z',
			indexUid: 'scp',
			startedAt: '2026-07-09T00:00:00.001Z',
			status: 'failed',
			type: 'documentAdditionOrUpdate',
			uid: 42
		});

		await expect(store.reconcilePendingTask()).resolves.toEqual({
			reason: 'document-task-failed',
			retryAfterMs: 60_000,
			status: 'failed'
		});
		expect(getTask).toHaveBeenCalledWith(42);
		expect(addDocuments).toHaveBeenCalledTimes(1);
	});

	it('allows only one never-settling retention cleanup request', async () => {
		const { deleteDocuments, store } = setupStore();
		deleteDocuments.mockReturnValue(new Promise(() => {}));

		await store.saveMany([createObservation('11')]);
		Reflect.set(store, 'pendingDocumentTaskUid', undefined);
		await store.saveMany([createObservation('12')]);

		expect(deleteDocuments).toHaveBeenCalledTimes(1);
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
	const deleteDocuments = jest.fn(async () => ({
		enqueuedAt: '2026-07-09T00:00:00.000Z',
		indexUid: 'scp',
		status: 'enqueued',
		taskUid: 43,
		type: 'documentDeletion'
	}));
	const index = {
		addDocuments,
		deleteDocuments,
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

	return { addDocuments, deleteDocuments, getTask, logger, store };
}

function createObservation(slotIndex: string): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}
