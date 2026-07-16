import {
	fullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaRange
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaFrontierPort } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import type {
	FullHistoryLedgerCloseMetaIngestionContext,
	FullHistoryLedgerCloseMetaIngestionReceipt,
	IngestFullHistoryLedgerCloseMeta
} from '../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import type { TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader } from '../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';

export interface ContinuousFullHistoryLedgerCloseMetaLoopConfig {
	readonly cycleLedgerCount: number;
	readonly errorBackoffMilliseconds: number;
	readonly idlePollMilliseconds: number;
	readonly lastAvailableLedger: number | null;
	readonly typedShardLedgerCount: number;
}

export type ContinuousFullHistoryLedgerCloseMetaEvent =
	| {
			readonly at: string;
			readonly event: 'ready';
			readonly nextLedger: number;
			readonly status: 'running';
	  }
	| {
			readonly at: string;
			readonly event: 'complete';
			readonly lastLedger: number;
			readonly nextLedger: number;
			readonly status: 'completed';
	  }
	| {
			readonly at: string;
			readonly event: 'idle';
			readonly frontierLedger: number;
			readonly nextLedger: number;
			readonly retryInMilliseconds: number;
	  }
	| {
			readonly at: string;
			readonly durationMilliseconds: number;
			readonly endLedger: number;
			readonly event: 'processed';
			readonly nextLedger: number;
			readonly sourceObjectCount: number;
			readonly startLedger: number;
			readonly typedShardCount: number;
	  }
	| {
			readonly at: string;
			readonly durationMilliseconds: number;
			readonly endLedger: number;
			readonly event: 'priority-processed';
			readonly nextLedger: number;
			readonly sourceObjectCount: number;
			readonly startLedger: number;
			readonly typedShardCount: number;
	  }
	| {
			readonly at: string;
			readonly event: 'cycle-error';
			readonly message: string;
			readonly retryInMilliseconds: number;
	  };

export interface ContinuousFullHistoryLedgerCloseMetaLoopDependencies {
	readonly emit: (event: ContinuousFullHistoryLedgerCloseMetaEvent) => void;
	readonly ensureStorageCapacity: () => Promise<void>;
	readonly formatError: (error: unknown) => string;
	readonly frontier: Pick<
		FullHistoryLedgerCloseMetaFrontierPort,
		'readLatestRange'
	>;
	readonly ingestion: Pick<
		IngestFullHistoryLedgerCloseMeta,
		'prepare' | 'ingestRange'
	>;
	readonly now: () => number;
	readonly priorityRangeReader: Pick<
		TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader,
		'readNextRange'
	>;
	readonly signal: AbortSignal;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export async function runContinuousFullHistoryLedgerCloseMetaLoop(
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies
): Promise<void> {
	let context = await dependencies.ingestion.prepare(dependencies.signal);
	let nextLedger = context.registeredSource.nextLedger;
	let reloadDurableState = false;
	dependencies.emit({
		at: isoTime(dependencies.now()),
		event: 'ready',
		nextLedger,
		status: 'running'
	});

	while (!dependencies.signal.aborted) {
		try {
			if (reloadDurableState) {
				context = await dependencies.ingestion.prepare(dependencies.signal);
				nextLedger = context.registeredSource.nextLedger;
				reloadDurableState = false;
			}
			if (boundedReplayComplete(nextLedger, config.lastAvailableLedger)) {
				dependencies.emit({
					at: isoTime(dependencies.now()),
					event: 'complete',
					lastLedger: config.lastAvailableLedger,
					nextLedger,
					status: 'completed'
				});
				return;
			}
			const priorityRange =
				config.lastAvailableLedger === null
					? await dependencies.priorityRangeReader.readNextRange({
							firstAvailableLedger:
								context.registeredSource.firstAvailableLedger,
							maximumLedgerCount: config.cycleLedgerCount,
							networkPassphraseHash:
								context.registeredSource.networkPassphraseHash,
							sourceBatchLedgerCount: context.config.ledgersPerBatch,
							typedShardLedgerCount: config.typedShardLedgerCount
						})
					: null;
			if (priorityRange !== null) {
				await dependencies.ensureStorageCapacity();
				const startedAt = dependencies.now();
				const receipt = await dependencies.ingestion.ingestRange(
					context,
					priorityRange,
					dependencies.signal
				);
				nextLedger = observedDurableNextLedger(nextLedger, receipt, false);
				const finishedAt = dependencies.now();
				dependencies.emit({
					at: isoTime(finishedAt),
					durationMilliseconds: Math.max(0, finishedAt - startedAt),
					endLedger: receipt.endLedger,
					event: 'priority-processed',
					nextLedger,
					sourceObjectCount: receipt.sourceObjectCount,
					startLedger: receipt.startLedger,
					typedShardCount: receipt.committedBatches.length
				});
				continue;
			}
			await dependencies.ensureStorageCapacity();
			const sourceFrontier = await dependencies.frontier.readLatestRange(
				context.config,
				dependencies.signal
			);
			const frontier = boundedFrontier(
				sourceFrontier,
				config.lastAvailableLedger
			);
			if (
				frontier.endSequence - nextLedger + 1 <
				config.typedShardLedgerCount
			) {
				dependencies.emit(
					idleEvent(
						dependencies,
						nextLedger,
						frontier,
						config.idlePollMilliseconds
					)
				);
				await dependencies.wait(
					config.idlePollMilliseconds,
					dependencies.signal
				);
				continue;
			}
			const range = cycleRange(
				nextLedger,
				frontier,
				config.cycleLedgerCount,
				config.typedShardLedgerCount
			);
			const startedAt = dependencies.now();
			const receipt = await dependencies.ingestion.ingestRange(
				context,
				range,
				dependencies.signal
			);
			nextLedger = observedDurableNextLedger(nextLedger, receipt, true);
			const finishedAt = dependencies.now();
			dependencies.emit({
				at: isoTime(finishedAt),
				durationMilliseconds: Math.max(0, finishedAt - startedAt),
				endLedger: receipt.endLedger,
				event: 'processed',
				nextLedger,
				sourceObjectCount: receipt.sourceObjectCount,
				startLedger: receipt.startLedger,
				typedShardCount: receipt.committedBatches.length
			});
		} catch (error) {
			if (dependencies.signal.aborted) break;
			reloadDurableState = true;
			dependencies.emit({
				at: isoTime(dependencies.now()),
				event: 'cycle-error',
				message: dependencies.formatError(error),
				retryInMilliseconds: config.errorBackoffMilliseconds
			});
			await dependencies.wait(
				config.errorBackoffMilliseconds,
				dependencies.signal
			);
		}
	}
}

function boundedReplayComplete(
	nextLedger: number,
	lastAvailableLedger: number | null
): lastAvailableLedger is number {
	return lastAvailableLedger !== null && nextLedger > lastAvailableLedger;
}

function boundedFrontier(
	frontier: FullHistoryLedgerCloseMetaRange,
	lastAvailableLedger: number | null
): FullHistoryLedgerCloseMetaRange {
	if (
		lastAvailableLedger === null ||
		frontier.endSequence <= lastAvailableLedger
	) {
		return frontier;
	}
	return fullHistoryLedgerCloseMetaRange(
		Math.min(frontier.startSequence, lastAvailableLedger),
		lastAvailableLedger
	);
}

function cycleRange(
	nextLedger: number,
	frontier: FullHistoryLedgerCloseMetaRange,
	maximumLedgerCount: number,
	typedShardLedgerCount: number
): FullHistoryLedgerCloseMetaRange {
	const available = frontier.endSequence - nextLedger + 1;
	const ledgerCount =
		Math.floor(
			Math.min(available, maximumLedgerCount) / typedShardLedgerCount
		) * typedShardLedgerCount;
	return fullHistoryLedgerCloseMetaRange(
		nextLedger,
		nextLedger + ledgerCount - 1
	);
}

function observedDurableNextLedger(
	previousNextLedger: number,
	receipt: FullHistoryLedgerCloseMetaIngestionReceipt,
	requireAdvance: boolean
): number {
	const nextLedger = receipt.committedBatches.reduce(
		(maximum, commit) => Math.max(maximum, commit.nextLedger),
		previousNextLedger
	);
	if (nextLedger < previousNextLedger) {
		throw new Error('LedgerCloseMeta durable watermark regressed');
	}
	if (requireAdvance && nextLedger === previousNextLedger) {
		throw new Error('LedgerCloseMeta durable watermark did not advance');
	}
	if (nextLedger > receipt.endLedger + 1) {
		throw new Error(
			'LedgerCloseMeta durable watermark exceeded processed range'
		);
	}
	return nextLedger;
}

function idleEvent(
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies,
	nextLedger: number,
	frontier: FullHistoryLedgerCloseMetaRange,
	retryInMilliseconds: number
): ContinuousFullHistoryLedgerCloseMetaEvent {
	return {
		at: isoTime(dependencies.now()),
		event: 'idle',
		frontierLedger: frontier.endSequence,
		nextLedger,
		retryInMilliseconds
	};
}

function isoTime(milliseconds: number): string {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) {
		throw new RangeError('Loop clock returned an invalid time');
	}
	return new Date(milliseconds).toISOString();
}

export function waitForFullHistoryLedgerCloseMetaLoop(
	milliseconds: number,
	signal: AbortSignal
): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(finish, milliseconds);
		const onAbort = (): void => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			reject(signal.reason);
		};
		function finish(): void {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
	});
}
