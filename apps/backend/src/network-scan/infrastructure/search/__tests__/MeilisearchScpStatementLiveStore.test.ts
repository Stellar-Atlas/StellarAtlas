import { mock } from 'jest-mock-extended';
import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { MeilisearchScpStatementLiveStore } from '../MeilisearchScpStatementLiveStore.js';

jest.mock('meilisearch', () => ({ Meilisearch: jest.fn() }));

describe('MeilisearchScpStatementLiveStore', () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('enqueues live SCP documents without waiting for task completion', async () => {
		const { addDocuments, store } = setupStore();

		const outcome = await store.saveMany([createObservation('11')]);

		expect(outcome).toEqual({ status: 'accepted', taskPending: true });
		expect(addDocuments).toHaveBeenCalledTimes(1);
	});

	it('writes deterministic documents without a volatile indexing timestamp', async () => {
		jest.useFakeTimers().setSystemTime(1_000_000);
		const { addDocuments, getTask, store } = setupStore();
		const observation = createObservation('11');
		getTask.mockResolvedValue(meiliTask(42, 'succeeded'));

		await store.saveMany([observation]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		jest.setSystemTime(2_000_000);
		await store.saveMany([observation]);

		const firstDocuments = addDocuments.mock.calls[0]?.[0];
		const secondDocuments = addDocuments.mock.calls[1]?.[0];
		expect(firstDocuments).toEqual(secondDocuments);
		expect(firstDocuments?.[0]).not.toHaveProperty('indexedAt');
		expect(firstDocuments?.[0]).toMatchObject({
			pledges: observation.pledges,
			signature: observation.signature,
			statementXdr: observation.statementXdr,
			values: observation.values
		});
	});

	it('configures only fields required by live SCP queries on the v2 schema', async () => {
		const updateSettings = jest.fn(() => ({
			waitTask: jest.fn(async () => ({ status: 'succeeded' }))
		}));
		const index = {
			getSettings: jest.fn(async () => ({
				filterableAttributes: [],
				searchableAttributes: ['*'],
				sortableAttributes: []
			})),
			search: jest.fn(async () => ({ hits: [] })),
			tasks: { getTask: jest.fn() },
			updateSettings
		} as unknown as ConstructorParameters<
			typeof MeilisearchScpStatementLiveStore
		>[2];
		const store = new MeilisearchScpStatementLiveStore(
			{ indexName: 'stellaratlas_scp_statements_v2' },
			undefined,
			index
		);

		await expect(store.findLatest({ limit: 10 })).resolves.toEqual([]);
		expect(updateSettings).toHaveBeenCalledWith({
			filterableAttributes: [
				'nodeId',
				'observedAtMs',
				'slotIndex',
				'statementHash'
			],
			searchableAttributes: [],
			sortableAttributes: ['observedAtMs', 'statementHash']
		});
	});

	it('uses direction-aware cursor filters for stable live pages', async () => {
		jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
		const { search, store } = setupStore();
		const after = { observedAtMs: 900_000, statementHash: 'statement-10' };

		await store.findLatest({ after, limit: 10, order: 'desc' });
		await store.findLatest({ after, limit: 10, order: 'asc' });

		expect(search).toHaveBeenNthCalledWith(
			1,
			'',
			expect.objectContaining({
				filter: expect.stringContaining('statementHash < "statement-10"'),
				sort: ['observedAtMs:desc', 'statementHash:desc']
			})
		);
		expect(search).toHaveBeenNthCalledWith(
			2,
			'',
			expect.objectContaining({
				filter: expect.stringContaining('statementHash > "statement-10"'),
				sort: ['observedAtMs:asc', 'statementHash:asc']
			})
		);
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

	it('blocks writes while accepted-task reconciliation reports processing', async () => {
		jest.useFakeTimers().setSystemTime(1_000_000);
		const { addDocuments, getTask, store } = setupStore();
		getTask.mockResolvedValueOnce(meiliTask(42, 'processing'));

		await store.saveMany([createObservation('11')]);
		jest.advanceTimersByTime(5_000);
		const outcome = await store.saveMany([createObservation('12')]);

		expect(getTask).toHaveBeenCalledWith(42);
		expect(addDocuments).toHaveBeenCalledTimes(1);
		expect(outcome).toEqual({
			reason: 'document-task-pending',
			retryAfterMs: 5_000,
			status: 'deferred'
		});
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

	it('waits for document settlement and an idle hysteresis before cleanup', async () => {
		jest.useFakeTimers().setSystemTime(1_000_000);
		const { deleteDocuments, getTask, store } = setupStore();
		getTask.mockResolvedValue(meiliTask(42, 'succeeded'));

		await store.saveMany([createObservation('11')]);
		jest.advanceTimersByTime(30_000);
		await flushMicrotasks();
		expect(deleteDocuments).not.toHaveBeenCalled();

		await store.reconcilePendingTask();
		jest.advanceTimersByTime(29_999);
		await flushMicrotasks();
		expect(deleteDocuments).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);
		await flushMicrotasks();
		expect(deleteDocuments).toHaveBeenCalledTimes(1);
	});

	it('coalesces settled writes and bounds cleanup to one task per cadence', async () => {
		jest.useFakeTimers().setSystemTime(1_000_000);
		const { deleteDocuments, getTask, store } = setupStore();
		getTask.mockImplementation(async (uid: number) =>
			meiliTask(uid, 'succeeded')
		);

		await store.saveMany([createObservation('11')]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		await store.saveMany([createObservation('12')]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		jest.advanceTimersByTime(30_000);
		await flushMicrotasks();
		expect(deleteDocuments).toHaveBeenCalledTimes(1);

		await store.saveMany([createObservation('13')]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		jest.advanceTimersByTime(294_999);
		await flushMicrotasks();
		expect(deleteDocuments).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(1);
		await flushMicrotasks();
		expect(deleteDocuments).toHaveBeenCalledTimes(2);
	});

	it('allows only one never-settling retention cleanup request', async () => {
		jest.useFakeTimers().setSystemTime(1_000_000);
		const { deleteDocuments, getTask, store } = setupStore();
		getTask.mockResolvedValue(meiliTask(42, 'succeeded'));
		deleteDocuments.mockReturnValue(new Promise(() => {}));

		await store.saveMany([createObservation('11')]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		jest.advanceTimersByTime(30_000);
		await flushMicrotasks();

		await store.saveMany([createObservation('12')]);
		jest.advanceTimersByTime(5_000);
		await store.reconcilePendingTask();
		jest.advanceTimersByTime(300_000);
		await flushMicrotasks();

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
	const search = jest.fn(async () => ({ hits: [] }));
	const index = {
		addDocuments,
		deleteDocuments,
		search,
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

	return { addDocuments, deleteDocuments, getTask, logger, search, store };
}

function createObservation(slotIndex: string): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {
			commit: { counter: 1, value: 'value' },
			nH: 1,
			quorumSetHash: 'quorum-set'
		},
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: [
			{
				closeTime: '1783209600',
				txSetHash: 'transaction-set',
				upgradeCount: 1,
				value: 'value'
			}
		]
	};
}

async function flushMicrotasks(): Promise<void> {
	for (let iteration = 0; iteration < 4; iteration += 1) {
		await Promise.resolve();
	}
}

function meiliTask(uid: number, status: 'processing' | 'succeeded') {
	return {
		batchUid: null,
		canceledBy: null,
		duration: status === 'succeeded' ? 'PT0.01S' : null,
		enqueuedAt: '2026-07-09T00:00:00.000Z',
		error: null,
		finishedAt: status === 'succeeded' ? '2026-07-09T00:00:00.010Z' : null,
		indexUid: 'scp',
		startedAt: '2026-07-09T00:00:00.001Z',
		status,
		type: uid === 43 ? 'documentDeletion' : 'documentAdditionOrUpdate',
		uid
	};
}
