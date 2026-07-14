import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaIngestionContext } from '../../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import {
	runContinuousFullHistoryLedgerCloseMetaLoop,
	type ContinuousFullHistoryLedgerCloseMetaEvent
} from '../ContinuousFullHistoryLedgerCloseMetaLoop.js';

describe('runContinuousFullHistoryLedgerCloseMetaLoop', () => {
	it('processes from the durable watermark in a bounded cycle', async () => {
		const controller = new AbortController();
		const events: ContinuousFullHistoryLedgerCloseMetaEvent[] = [];
		const ranges: Array<{ end: number; start: number }> = [];
		await runContinuousFullHistoryLedgerCloseMetaLoop(config(), {
			emit: (event) => events.push(event),
			ensureStorageCapacity: () => Promise.resolve(),
			formatError: String,
			frontier: {
				readLatestRange: () =>
					Promise.resolve(fullHistoryLedgerCloseMetaRange(10, 10))
			},
			ingestion: {
				ingestRange: (_context, range) => {
					ranges.push({
						end: range.endSequence,
						start: range.startSequence
					});
					controller.abort();
					return Promise.resolve({
						committedBatches: [
							{
								batchId: 'batch',
								nextLedger: 7,
								replayed: false,
								watermarkVersion: 1
							}
						],
						endLedger: 6,
						ledgerCount: 4,
						sourceObjectCount: 4,
						startLedger: 3
					});
				},
				prepare: () => Promise.resolve(context(3))
			},
			now: () => 1_000,
			signal: controller.signal,
			wait: () => Promise.resolve()
		});

		expect(ranges).toEqual([{ end: 6, start: 3 }]);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ event: 'ready', nextLedger: 3 }),
				expect.objectContaining({ event: 'processed', nextLedger: 7 })
			])
		);
	});

	it('reports caught-up state and polls without inventing work', async () => {
		const controller = new AbortController();
		const events: ContinuousFullHistoryLedgerCloseMetaEvent[] = [];
		let ingestCalls = 0;
		await runContinuousFullHistoryLedgerCloseMetaLoop(config(), {
			emit: (event) => events.push(event),
			ensureStorageCapacity: () => Promise.resolve(),
			formatError: String,
			frontier: {
				readLatestRange: () =>
					Promise.resolve(fullHistoryLedgerCloseMetaRange(10, 10))
			},
			ingestion: {
				ingestRange: () => {
					ingestCalls += 1;
					throw new Error('unexpected ingestion');
				},
				prepare: () => Promise.resolve(context(11))
			},
			now: () => 1_000,
			signal: controller.signal,
			wait: () => {
				controller.abort();
				return Promise.resolve();
			}
		});

		expect(ingestCalls).toBe(0);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: 'idle',
					frontierLedger: 10,
					retryInMilliseconds: 20
				})
			])
		);
	});

	it('reloads the durable watermark after a partially committed cycle fails', async () => {
		const controller = new AbortController();
		const ranges: Array<{ end: number; start: number }> = [];
		let prepareCalls = 0;
		let ingestCalls = 0;
		await runContinuousFullHistoryLedgerCloseMetaLoop(config(), {
			emit: () => undefined,
			ensureStorageCapacity: () => Promise.resolve(),
			formatError: String,
			frontier: {
				readLatestRange: () =>
					Promise.resolve(fullHistoryLedgerCloseMetaRange(10, 10))
			},
			ingestion: {
				ingestRange: (_context, range) => {
					ingestCalls += 1;
					ranges.push({
						end: range.endSequence,
						start: range.startSequence
					});
					if (ingestCalls === 1) {
						throw new Error('one shard failed after another committed');
					}
					controller.abort();
					return Promise.resolve({
						committedBatches: [
							{
								batchId: 'recovered-batch',
								nextLedger: 9,
								replayed: false,
								watermarkVersion: 2
							}
						],
						endLedger: 8,
						ledgerCount: 4,
						sourceObjectCount: 4,
						startLedger: 5
					});
				},
				prepare: () => {
					prepareCalls += 1;
					return Promise.resolve(context(prepareCalls === 1 ? 3 : 5));
				}
			},
			now: () => 1_000,
			signal: controller.signal,
			wait: () => Promise.resolve()
		});

		expect(prepareCalls).toBe(2);
		expect(ranges).toEqual([
			{ end: 6, start: 3 },
			{ end: 8, start: 5 }
		]);
	});

	it.each([
		{ expectedCalls: 0, frontier: 65, label: '63 ledgers' },
		{ expectedCalls: 1, frontier: 66, label: '64 ledgers' }
	])(
		'waits for a complete production shard with $label available',
		async ({ expectedCalls, frontier }) => {
			const controller = new AbortController();
			let ingestCalls = 0;
			await runContinuousFullHistoryLedgerCloseMetaLoop(
				{ ...config(), cycleLedgerCount: 64, typedShardLedgerCount: 64 },
				{
					emit: () => undefined,
					ensureStorageCapacity: () => Promise.resolve(),
					formatError: String,
					frontier: {
						readLatestRange: () =>
							Promise.resolve(
								fullHistoryLedgerCloseMetaRange(frontier, frontier)
							)
					},
					ingestion: {
						ingestRange: (_context, range) => {
							ingestCalls += 1;
							controller.abort();
							return Promise.resolve({
								committedBatches: [
									{
										batchId: 'batch',
										nextLedger: range.endSequence + 1,
										replayed: false,
										watermarkVersion: 1
									}
								],
								endLedger: range.endSequence,
								ledgerCount: range.ledgerCount,
								sourceObjectCount: range.ledgerCount,
								startLedger: range.startSequence
							});
						},
						prepare: () => Promise.resolve(context(3))
					},
					now: () => 1_000,
					signal: controller.signal,
					wait: () => {
						controller.abort();
						return Promise.resolve();
					}
				}
			);
			expect(ingestCalls).toBe(expectedCalls);
		}
	);
});

function config() {
	return {
		cycleLedgerCount: 4,
		errorBackoffMilliseconds: 30,
		idlePollMilliseconds: 20,
		typedShardLedgerCount: 2
	};
}

function context(
	nextLedger: number
): FullHistoryLedgerCloseMetaIngestionContext {
	return {
		config: {
			batchesPerPartition: 64_000,
			compression: 'zstd',
			ledgersPerBatch: 1,
			networkPassphrase: 'Public Global Stellar Network ; September 2015',
			version: '1.0'
		},
		registeredSource: {
			configDigest: fullHistoryLedgerCloseMetaSha256Digest('11'.repeat(32)),
			firstAvailableLedger: fullHistoryLedgerCloseMetaRange(3, 3).startSequence,
			networkPassphraseHash: fullHistoryLedgerCloseMetaSha256Digest(
				'22'.repeat(32)
			),
			nextLedger,
			sourceId: 'source',
			watermarkVersion: 0
		}
	};
}
