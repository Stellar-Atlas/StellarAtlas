import {
	fullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaRange
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	isFullHistoryCurrentCapacityAllowanceActive,
	type FullHistoryCurrentCapacityAllowance
} from '../../full-history-ledger-close-meta/FullHistoryCurrentCapacityAllowance.js';
import type { FullHistoryLedgerCloseMetaFrontierPort } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import type {
	FullHistoryLedgerCloseMetaIngestionContext,
	FullHistoryLedgerCloseMetaIngestionReceipt,
	IngestFullHistoryLedgerCloseMeta
} from '../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import type { TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader } from '../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';
import { createShardRanges } from '../../../use-cases/ingest-full-history-ledger-close-meta/FullHistoryLedgerCloseMetaShardRanges.js';
import type { PendingPlan, PendingPlanStore } from './FullHistoryLedgerCloseMetaPendingPlan.js';
import type {
	FullHistoryLedgerCloseMetaAdmissionDecision,
	FullHistoryLedgerCloseMetaAdmissionReason,
	FullHistoryLedgerCloseMetaAdmissionSnapshot
} from '../../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaAdmission.js';

export interface ContinuousFullHistoryLedgerCloseMetaLoopConfig {
	readonly currentCapacityAllowance?: FullHistoryCurrentCapacityAllowance;
	readonly admissionRetryMilliseconds: number;
	readonly cycleCooldownMilliseconds: number;
	readonly cycleLedgerCount: number;
	readonly errorBackoffMilliseconds: number;
	readonly idlePollMilliseconds: number;
	readonly lastAvailableLedger: number | null;
	readonly prioritizeCurrent?: boolean;
	readonly typedShardLedgerCount: number;
}

export type ContinuousFullHistoryLedgerCloseMetaEvent =
	| {
			readonly at: string;
			readonly event: 'admission-deferred';
			readonly reasons: readonly FullHistoryLedgerCloseMetaAdmissionReason[];
			readonly retryInMilliseconds: number;
			readonly snapshot: FullHistoryLedgerCloseMetaAdmissionSnapshot;
	  }
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
	readonly admitCycle: (current?: boolean) => Promise<FullHistoryLedgerCloseMetaAdmissionDecision>;
	readonly emit: (event: ContinuousFullHistoryLedgerCloseMetaEvent) => void;
	readonly ensureStorageCapacity: (plan: PendingPlan) => Promise<void>;
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
	readonly pendingPlans: PendingPlanStore;
	readonly priorityRangeReader: Pick<
		TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader,
		'readNextRange' | 'readNextHistoricalRange'
	>;
	readonly signal: AbortSignal;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const MAXIMUM_CONSECUTIVE_PRIORITY_RANGES = 4;

export async function runContinuousFullHistoryLedgerCloseMetaLoop(
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies
): Promise<void> {
	if (config.prioritizeCurrent && config.lastAvailableLedger !== null) {
		throw new Error('prioritize current cannot be combined with bounded historical replay');
	}
	if (config.currentCapacityAllowance !== undefined && !config.prioritizeCurrent) {
		throw new Error('current capacity allowance requires prioritize current');
	}
	let context: FullHistoryLedgerCloseMetaIngestionContext | null = null;
	let nextLedger: number | null = null;
	let readyEmitted = false;
	let reloadDurableState = true;
	let priorityStreak = 0;

	while (!dependencies.signal.aborted) {
		try {
			const currentCapacityOnly = isFullHistoryCurrentCapacityAllowanceActive(
				config.currentCapacityAllowance, dependencies.now());
			if (reloadDurableState) {
				if (!(await admitCycle(config, dependencies, config.prioritizeCurrent))) continue;
				context = await dependencies.ingestion.prepare(dependencies.signal);
				nextLedger = context.registeredSource.nextLedger;
				reloadDurableState = false;
				if (!readyEmitted) {
					dependencies.emit({
						at: isoTime(dependencies.now()),
						event: 'ready',
						nextLedger,
						status: 'running'
					});
					readyEmitted = true;
				}
			}
			if (context === null || nextLedger === null) {
				throw new Error('LedgerCloseMeta durable state is unavailable');
			}
			const cycleContext = context;
			const durableNextLedger = nextLedger;
			const pending = await dependencies.pendingPlans.read();
			if (pending !== null) {
				assertCurrentCapacityPlan(config, dependencies, pending);
				if (pending.endLedger - pending.startLedger + 1 > config.cycleLedgerCount ||
					(config.lastAvailableLedger !== null && pending.endLedger > config.lastAvailableLedger)) {
					throw new Error('Pending ingestion plan exceeds configured cycle capacity or replay bound');
				}
				const expected = createPendingPlan(cycleContext, config, fullHistoryLedgerCloseMetaRange(
					pending.startLedger, pending.endLedger), pending.kind);
				if (JSON.stringify(pending) !== JSON.stringify(expected)) {
					throw new Error('Pending ingestion plan does not match source identity or partition configuration');
				}
				if (!(await admitCycle(config, dependencies,
					config.prioritizeCurrent && pending.kind === 'priority'))) continue;
				nextLedger = await processRecordedRange(config, dependencies, cycleContext, durableNextLedger, pending);
				priorityStreak = pending.kind === 'priority'
					? Math.min(priorityStreak + 1, MAXIMUM_CONSECUTIVE_PRIORITY_RANGES)
					: 0;
				continue;
			}
			if (
				boundedReplayComplete(durableNextLedger, config.lastAvailableLedger)
			) {
				dependencies.emit({
					at: isoTime(dependencies.now()),
					event: 'complete',
					lastLedger: config.lastAvailableLedger,
					nextLedger: durableNextLedger,
					status: 'completed'
				});
				return;
			}
			if (!(await admitCycle(config, dependencies, config.prioritizeCurrent))) continue;
			const sourceFrontier = await dependencies.frontier.readLatestRange(
				cycleContext.config,
				dependencies.signal
			);
			dependencies.signal.throwIfAborted();
			const rangeOptions = {
				...(currentCapacityOnly ? { minimumPriorityLedger: config.currentCapacityAllowance!.minimumLedger } : {}),
				durableNextLedger,
				firstAvailableLedger: cycleContext.registeredSource.firstAvailableLedger,
				latestAvailableLedger: sourceFrontier.endSequence,
				maximumLedgerCount: config.cycleLedgerCount,
				networkPassphraseHash: cycleContext.registeredSource.networkPassphraseHash,
				sourceBatchLedgerCount: cycleContext.config.ledgersPerBatch,
				typedShardLedgerCount: config.typedShardLedgerCount
			};
			let offeredHistoricalRange: FullHistoryLedgerCloseMetaRange | null | undefined;
			let historicalOfferFailed = false;
			if (!currentCapacityOnly && config.lastAvailableLedger === null &&
				priorityStreak >= MAXIMUM_CONSECUTIVE_PRIORITY_RANGES) {
				if (await admitCycle(config, dependencies)) {
					try {
						offeredHistoricalRange = await dependencies.priorityRangeReader.readNextHistoricalRange(rangeOptions);
					} catch (error) {
						if (dependencies.signal.aborted) throw error;
						reloadDurableState = true;
						historicalOfferFailed = true;
						dependencies.emit({
							at: isoTime(dependencies.now()), event: 'cycle-error',
							message: dependencies.formatError(error),
							retryInMilliseconds: config.errorBackoffMilliseconds
						});
						await dependencies.wait(config.errorBackoffMilliseconds, dependencies.signal);
					}
					if (offeredHistoricalRange !== undefined && offeredHistoricalRange !== null) {
						nextLedger = await processRecordedRange(config, dependencies, cycleContext, durableNextLedger,
							createPendingPlan(cycleContext, config, offeredHistoricalRange, 'historical'));
						priorityStreak = 0;
						continue;
					}
				}
				// An unsuccessful historical offer can wait; recheck current admission.
				if (!(await admitCycle(config, dependencies, config.prioritizeCurrent))) continue;
			}
			const priorityRange =
				config.lastAvailableLedger === null
					? await dependencies.priorityRangeReader.readNextRange(rangeOptions)
					: null;
			if (priorityRange !== null) {
				nextLedger = await processRecordedRange(config, dependencies, cycleContext, durableNextLedger,
					createPendingPlan(cycleContext, config, priorityRange, 'priority'));
				priorityStreak = Math.min(priorityStreak + 1, MAXIMUM_CONSECUTIVE_PRIORITY_RANGES);
				continue;
			}
			if (historicalOfferFailed) continue;
			if (currentCapacityOnly) {
				dependencies.emit(idleEvent(dependencies, durableNextLedger, sourceFrontier, config.idlePollMilliseconds));
				await dependencies.wait(config.idlePollMilliseconds, dependencies.signal);
				continue;
			}
			const frontier = boundedFrontier(
				sourceFrontier,
				config.lastAvailableLedger
			);
			if (config.prioritizeCurrent && !(await admitCycle(config, dependencies))) continue;
			const range = offeredHistoricalRange === undefined
				? await dependencies.priorityRangeReader.readNextHistoricalRange({
					...rangeOptions,
					latestAvailableLedger: frontier.endSequence
				})
				: offeredHistoricalRange;
			if (range === null) {
				dependencies.emit(
					idleEvent(
						dependencies,
						durableNextLedger,
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
			nextLedger = await processRecordedRange(config, dependencies, cycleContext, durableNextLedger,
				createPendingPlan(cycleContext, config, range, 'historical'));
			priorityStreak = 0;
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

function createPendingPlan(context: FullHistoryLedgerCloseMetaIngestionContext,
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig, range: FullHistoryLedgerCloseMetaRange,
	kind: PendingPlan['kind']): PendingPlan {
	return {
		version: 1, kind,
		networkPassphraseHash: context.registeredSource.networkPassphraseHash,
		sourceId: context.registeredSource.sourceId,
		configDigest: context.registeredSource.configDigest,
		partitionVersion: 'source-aligned-remainder-v1',
		sourceBatchLedgerCount: context.config.ledgersPerBatch,
		typedShardLedgerCount: config.typedShardLedgerCount,
		startLedger: range.startSequence, endLedger: range.endSequence,
		shards: createShardRanges(range, context.config.ledgersPerBatch, config.typedShardLedgerCount)
			.map(shard => ({startLedger: shard.startSequence, endLedger: shard.endSequence}))
	};
}

async function processRecordedRange(config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies,
	context: FullHistoryLedgerCloseMetaIngestionContext, previousNextLedger: number,
	plan: PendingPlan): Promise<number> {
	let nextLedger = previousNextLedger;
	await runAdmittedAttempt(config, dependencies, async () => {
		assertCurrentCapacityPlan(config, dependencies, plan);
		await dependencies.ensureStorageCapacity(plan);
		await dependencies.pendingPlans.write(plan);
		const startedAt = dependencies.now();
		const receipt = await dependencies.ingestion.ingestRange(context,
			fullHistoryLedgerCloseMetaRange(plan.startLedger, plan.endLedger), dependencies.signal);
		nextLedger = observedDurableNextLedger(previousNextLedger, receipt,
			plan.kind === 'historical' && previousNextLedger <= plan.endLedger);
		await dependencies.pendingPlans.clear();
		const finishedAt = dependencies.now();
		dependencies.emit({
			at: isoTime(finishedAt), durationMilliseconds: Math.max(0, finishedAt - startedAt),
			endLedger: receipt.endLedger, event: plan.kind === 'priority' ? 'priority-processed' : 'processed',
			nextLedger, sourceObjectCount: receipt.sourceObjectCount,
			startLedger: receipt.startLedger, typedShardCount: receipt.committedBatches.length
		});
	});
	return nextLedger;
}

function assertCurrentCapacityPlan(config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies, plan: PendingPlan): void {
	const allowance = config.currentCapacityAllowance;
	if (allowance !== undefined && isFullHistoryCurrentCapacityAllowanceActive(allowance, dependencies.now()) &&
		(plan.kind !== 'priority' || plan.startLedger < allowance.minimumLedger)) {
		throw new Error('Current capacity window refuses non-current pending work; plan preserved');
	}
}

async function admitCycle(
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies,
	current = false
): Promise<boolean> {
	const decision = await dependencies.admitCycle(current);
	if (decision.admitted) return true;
	dependencies.emit({
		at: isoTime(dependencies.now()),
		event: 'admission-deferred',
		reasons: decision.reasons,
		retryInMilliseconds: config.admissionRetryMilliseconds,
		snapshot: decision.snapshot
	});
	await dependencies.wait(
		config.admissionRetryMilliseconds,
		dependencies.signal
	);
	return false;
}

async function runAdmittedAttempt(
	config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	dependencies: ContinuousFullHistoryLedgerCloseMetaLoopDependencies,
	attempt: () => Promise<void>
): Promise<void> {
	try {
		await attempt();
	} finally {
		if (!dependencies.signal.aborted && config.cycleCooldownMilliseconds > 0) {
			await dependencies.wait(
				config.cycleCooldownMilliseconds,
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

function observedDurableNextLedger(
	previousNextLedger: number,
	receipt: FullHistoryLedgerCloseMetaIngestionReceipt,
	requireAdvance: boolean
): number {
	for (const commit of receipt.committedBatches) {
		if (!Number.isSafeInteger(commit.nextLedger) || commit.nextLedger < previousNextLedger) {
			throw new Error('LedgerCloseMeta durable watermark is invalid or regressed');
		}
	}
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
	// The repository can advance across adjacent batches published by prior cycles.
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
