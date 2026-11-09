import { settlePairedPendingPublication, type FencedPairedCurrentAdmission } from './FullHistoryPairedCurrentAdmission.js';
import { performance } from 'node:perf_hooks';
import type { ScopedCurrentArm, ScopedCurrentAttemptPolicy } from './FullHistoryScopedCurrentAttempt.js';
import {
	fullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaRange
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	isCurrentCapacityRange,
	isFullHistoryCurrentCapacityAllowanceActive,
	type FullHistoryCurrentCapacityAllowance,
	type FullHistoryCurrentOnlyCapacity
} from '../../full-history-ledger-close-meta/FullHistoryCurrentCapacityAllowance.js';
import type { FullHistoryLedgerCloseMetaFrontierPort } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import type {
	FullHistoryLedgerCloseMetaIngestionContext,
	FullHistoryLedgerCloseMetaIngestionReceipt,
	IngestFullHistoryLedgerCloseMeta
} from '../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import type { TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader } from '../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';
import { createShardRanges } from '../../../use-cases/ingest-full-history-ledger-close-meta/FullHistoryLedgerCloseMetaShardRanges.js';
import { PendingPlanChangedError, type PendingPlan, type PendingPlanStore } from './FullHistoryLedgerCloseMetaPendingPlan.js';
import type {
	FullHistoryLedgerCloseMetaAdmissionDecision,
	FullHistoryLedgerCloseMetaAdmissionReason,
	FullHistoryLedgerCloseMetaAdmissionSnapshot
} from '../../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaAdmission.js';

export interface ContinuousFullHistoryLedgerCloseMetaLoopConfig {
	readonly currentCapacityAllowance?: FullHistoryCurrentCapacityAllowance;
	readonly currentOnlyCapacity?: FullHistoryCurrentOnlyCapacity;
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
	readonly pairedCurrentAdmission?: FencedPairedCurrentAdmission;
	readonly scopedCurrentAttempt?: {
		readonly policy: ScopedCurrentAttemptPolicy;
		readArm(): Promise<ScopedCurrentArm | null>;
	};
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
	if (config.currentOnlyCapacity !== undefined &&
		(!config.prioritizeCurrent || config.currentCapacityAllowance !== undefined)) {
		throw new Error('current-only capacity requires prioritize current without an expiring allowance');
	}
	if ((config.currentOnlyCapacity === undefined) !== (dependencies.pairedCurrentAdmission === undefined)) {
		throw new Error('current-only capacity requires paired admission checks');
	}
	const scoped = dependencies.scopedCurrentAttempt;
	const paired = dependencies.pairedCurrentAdmission;
	if ((config.currentOnlyCapacity?.scopedReserve === true) !== (scoped !== undefined) ||
		(scoped !== undefined && (config.cycleLedgerCount !== 128 || config.typedShardLedgerCount !== 128))) {
		throw new Error('Scoped current attempt requires the paired 128-ledger configuration');
	}
	let scopedAttemptStarted = false;
	let context: FullHistoryLedgerCloseMetaIngestionContext | null = null;
	let nextLedger: number | null = null;
	let readyEmitted = false;
	let reloadDurableState = true;
	let priorityStreak = 0;

	while (!dependencies.signal.aborted) {
		try {
			let scopedArm: ScopedCurrentArm | undefined;
			if (scoped !== undefined && paired !== undefined) {
				const pending = await dependencies.pendingPlans.read();
				if (pending !== null) {
					// Settlement needs no admission permit or provider preparation. A spent or
					// invalid arm can never turn a not-captured plan back into native work.
					assertScopedPlan(pending, scoped.policy);
					const ownsPlan = () => dependencies.pendingPlans.matchesConsumedScopedAttempt(scoped.policy.permitId, pending);
					if (ownsPlan() && await settlePairedPendingPublication(
						paired, pending, config, dependencies, () => {
							if (!ownsPlan())
								throw new PendingPlanChangedError('Scoped pending plan lost its spent-inode binding; preserved');
						}
					)) continue;
					await dependencies.wait(Math.max(30_000, config.idlePollMilliseconds), dependencies.signal);
					continue;
				}
				const arm = scopedAttemptStarted ? null : await scoped.readArm();
				if (arm === null) {
					await dependencies.wait(config.idlePollMilliseconds, dependencies.signal);
					continue;
				}
				// A failed preflight is terminal for this invocation. The arm binds it
				// to this invocation and the durable receipt also prevents reuse.
				scopedAttemptStarted = true;
				scopedArm = arm;
			}
			const minimumPriorityLedger = currentCapacityMinimumLedger(config, dependencies.now());
			const currentCapacityOnly = minimumPriorityLedger !== undefined;
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
				if (scoped !== undefined) continue; // Handle only through the settlement branch.
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
				const paired = dependencies.pairedCurrentAdmission;
				if (paired !== undefined && await settlePairedPendingPublication(paired, pending, config, dependencies)) continue;
				if (!(await admitCycle(config, dependencies,
					config.prioritizeCurrent && pending.kind === 'priority'))) continue;
				nextLedger = await processRecordedRange(config, dependencies, cycleContext, durableNextLedger, pending, true);
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
			if (scoped !== undefined && (sourceFrontier.endSequence < scoped.policy.endLedger ||
				sourceFrontier.endSequence - scoped.policy.endLedger > 128)) {
				throw new Error('Scoped current attempt does not match a fresh near-head frontier');
			}
			const rangeOptions = {
				...(scoped !== undefined ? { minimumPriorityLedger: scoped.policy.startLedger }
					: minimumPriorityLedger === undefined ? {} : { minimumPriorityLedger }),
				durableNextLedger,
				firstAvailableLedger: cycleContext.registeredSource.firstAvailableLedger,
				latestAvailableLedger: scoped?.policy.endLedger ?? sourceFrontier.endSequence,
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
					createPendingPlan(cycleContext, config, priorityRange, 'priority'), false, scopedArm);
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
			if (error instanceof PendingPlanChangedError && scoped === undefined) throw error;
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

function assertScopedPlan(plan: PendingPlan, policy: ScopedCurrentAttemptPolicy): void {
	if (plan.kind !== 'priority' || plan.typedShardLedgerCount !== 128 || plan.shards.length !== 1 ||
		plan.startLedger !== policy.startLedger || plan.endLedger !== policy.endLedger) {
		throw new Error('Scoped current pending plan does not match the authorized range and geometry; preserved');
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
	plan: PendingPlan, alreadyRecorded = false, scopedArm?: ScopedCurrentArm): Promise<number> {
	let nextLedger = previousNextLedger;
	await runAdmittedAttempt(config, dependencies, async () => {
		assertCurrentCapacityPlan(config, dependencies, plan);
		await dependencies.ensureStorageCapacity(plan);
		const paired = dependencies.pairedCurrentAdmission;
		const scoped = dependencies.scopedCurrentAttempt;
		let beforeConversion: (() => Promise<void>) | undefined;
		if (paired === undefined) {
			await dependencies.pendingPlans.write(plan);
		} else if (scoped !== undefined) {
			if (scopedArm === undefined || alreadyRecorded)
				throw new Error('Scoped current attempt is disarmed; no conversion authorized');
			assertScopedPlan(plan, scoped.policy);
			const assertScopedAuthority = async (checkPlan?: () => void) => {
				const started = performance.now();
				await paired.assertCapacity(plan, dependencies.signal);
				const checkArm = await scopedArm();
				await paired.assertHeld(dependencies.signal);
				dependencies.signal.throwIfAborted();
				checkArm();
				checkPlan?.();
				if (performance.now() - started > 4_000)
					throw new Error('Scoped current capacity or authority evidence expired');
			};
			const installed = await dependencies.pendingPlans.installScopedAttempt(scoped.policy.permitId, plan, assertScopedAuthority);
			beforeConversion = () => assertScopedAuthority(() => {
				if (!dependencies.pendingPlans.matchesConsumedScopedAttempt(scoped.policy.permitId, installed)) {
					throw new PendingPlanChangedError('Scoped pending plan lost its spent-inode binding; preserved');
				}
			});
		} else {
			await paired.assertCapacity(plan, dependencies.signal);
			if (!alreadyRecorded) {
				await dependencies.pendingPlans.installVerified(plan, () => paired.assertHeld(dependencies.signal));
			} else {
				await dependencies.pendingPlans.confirmRecorded(plan, () => paired.assertHeld(dependencies.signal));
			}
			// Either durability check can be slow; refresh capacity before fetching input.
			await paired.assertCapacity(plan, dependencies.signal);
			beforeConversion = () => paired.assertHeld(dependencies.signal);
		}
		const startedAt = dependencies.now();
		const range = fullHistoryLedgerCloseMetaRange(plan.startLedger, plan.endLedger);
		const receipt = beforeConversion === undefined
			? await dependencies.ingestion.ingestRange(context, range, dependencies.signal)
			: await dependencies.ingestion.ingestRange(context, range, dependencies.signal, beforeConversion);
		nextLedger = observedDurableNextLedger(previousNextLedger, receipt,
			plan.kind === 'historical' && previousNextLedger <= plan.endLedger);
		if (paired === undefined) await dependencies.pendingPlans.clear();
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
	const minimumLedger = currentCapacityMinimumLedger(config, dependencies.now());
	if (minimumLedger !== undefined && !isCurrentCapacityRange(plan, minimumLedger)) {
		throw new Error('Current capacity window refuses non-current pending work; plan preserved');
	}
}

function currentCapacityMinimumLedger(config: ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	nowMilliseconds: number): number | undefined {
	if (config.currentOnlyCapacity !== undefined) return config.currentOnlyCapacity.minimumLedger;
	const allowance = config.currentCapacityAllowance;
	return allowance !== undefined &&
		isFullHistoryCurrentCapacityAllowanceActive(allowance, nowMilliseconds)
		? allowance.minimumLedger : undefined;
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
