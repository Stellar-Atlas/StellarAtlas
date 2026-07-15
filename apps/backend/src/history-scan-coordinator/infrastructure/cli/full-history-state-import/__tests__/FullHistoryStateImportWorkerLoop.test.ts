import {
	runFullHistoryStateImportWorkerLoop,
	type FullHistoryStateImportWorkerEvent
} from '../FullHistoryStateImportWorkerLoop.js';

describe('runFullHistoryStateImportWorkerLoop', () => {
	it('emits a durable completion receipt and continues until aborted', async () => {
		const controller = new AbortController();
		const events: FullHistoryStateImportWorkerEvent[] = [];
		await runFullHistoryStateImportWorkerLoop(config(), {
			emit: (event) => events.push(event),
			execute: () => {
				controller.abort();
				return Promise.resolve({
					kind: 'state-import' as const,
					receipt: {
						batchId: '00000000-0000-4000-8000-000000000001',
						dataset: 'account-state-changes' as const,
						recordCount: 42n
					}
				});
			},
			formatError: String,
			now: () => 1_000,
			signal: controller.signal,
			wait: () => Promise.resolve(),
			workerIndex: 1
		});

		expect(events).toEqual([
			expect.objectContaining({
				batchId: '00000000-0000-4000-8000-000000000001',
				dataset: 'account-state-changes',
				recordCount: '42',
				status: 'complete'
			})
		]);
	});

	it('emits canonical proof coverage distinctly from imported staging rows', async () => {
		const controller = new AbortController();
		const events: FullHistoryStateImportWorkerEvent[] = [];
		await runFullHistoryStateImportWorkerLoop(config(), {
			emit: (event) => events.push(event),
			execute: () => {
				controller.abort();
				return Promise.resolve({
					kind: 'canonical-coverage' as const,
					receipt: {
						batchId: '00000000-0000-4000-8000-000000000002',
						canonicalBatchCount: 2,
						ledgerCount: 128,
						minimumProofVersion: 6,
						status: 'complete' as const
					}
				});
			},
			formatError: String,
			now: () => 2_000,
			signal: controller.signal,
			wait: () => Promise.resolve(),
			workerIndex: 3
		});
		expect(events).toEqual([
			expect.objectContaining({
				canonicalBatchCount: 2,
				event: 'canonical-coverage',
				ledgerCount: 128,
				minimumProofVersion: 6,
				status: 'complete',
				worker: 3
			})
		]);
	});

	it.each([
		{ expectedStatus: 'idle', execute: () => Promise.resolve(null) },
		{
			expectedStatus: 'failed',
			execute: () => Promise.reject(new Error('fixture failure'))
		}
	])(
		'backs off after an $expectedStatus cycle',
		async ({ execute, expectedStatus }) => {
			const controller = new AbortController();
			const events: FullHistoryStateImportWorkerEvent[] = [];
			const waits: number[] = [];
			await runFullHistoryStateImportWorkerLoop(config(), {
				emit: (event) => events.push(event),
				execute,
				formatError: (error) =>
					error instanceof Error ? error.message : String(error),
				now: () => 1_000,
				signal: controller.signal,
				wait: (milliseconds) => {
					waits.push(milliseconds);
					controller.abort();
					return Promise.resolve();
				},
				workerIndex: 2
			});

			expect(events[0]).toEqual(
				expect.objectContaining({ status: expectedStatus, worker: 2 })
			);
			expect(waits).toEqual([expectedStatus === 'idle' ? 15 : 30]);
		}
	);
});

function config() {
	return { errorBackoffMilliseconds: 30, idlePollMilliseconds: 15 };
}
