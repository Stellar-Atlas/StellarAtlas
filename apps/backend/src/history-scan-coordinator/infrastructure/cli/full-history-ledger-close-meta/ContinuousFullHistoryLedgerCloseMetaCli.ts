import type { DataSource } from 'typeorm';
import {
	composeFullHistoryLedgerCloseMetaService,
	FULL_HISTORY_LEDGER_CLOSE_META_MAXIMUM_OUTPUT_BYTES_PER_SHARD,
	type FullHistoryLedgerCloseMetaComposition
} from './FullHistoryLedgerCloseMetaComposition.js';
import {
	acquireFullHistoryLedgerCloseMetaLeadership,
	type FullHistoryLedgerCloseMetaLeadershipLease
} from './FullHistoryLedgerCloseMetaLeadership.js';
import {
	parseFullHistoryLedgerCloseMetaServiceConfig,
	type FullHistoryLedgerCloseMetaServiceConfig
} from './FullHistoryLedgerCloseMetaServiceConfig.js';
import {
	ensureFullHistoryLedgerCloseMetaRuntime,
	FULL_HISTORY_LEDGER_CLOSE_META_CLEANUP_INTERVAL_MILLISECONDS,
	removeStaleFullHistoryLedgerCloseMetaArtifacts,
	resetOwnedFullHistoryLedgerCloseMetaArtifacts
} from './FullHistoryLedgerCloseMetaRuntime.js';
import {
	runContinuousFullHistoryLedgerCloseMetaLoop,
	waitForFullHistoryLedgerCloseMetaLoop,
	type ContinuousFullHistoryLedgerCloseMetaEvent
} from './ContinuousFullHistoryLedgerCloseMetaLoop.js';

interface WritableOutput {
	write(value: string): unknown;
}

export interface ContinuousFullHistoryLedgerCloseMetaCliDependencies {
	readonly acquireLeadership: (
		dataSource: DataSource
	) => Promise<FullHistoryLedgerCloseMetaLeadershipLease>;
	readonly compose: (
		config: FullHistoryLedgerCloseMetaServiceConfig
	) => FullHistoryLedgerCloseMetaComposition;
	readonly ensureRuntime: (
		config: FullHistoryLedgerCloseMetaServiceConfig
	) => Promise<void>;
	readonly now: () => number;
	readonly reconcileRuntime: (
		config: FullHistoryLedgerCloseMetaServiceConfig,
		nowMilliseconds: number
	) => Promise<void>;
	readonly resetOwnedRuntime: (
		config: FullHistoryLedgerCloseMetaServiceConfig
	) => Promise<void>;
	readonly registerSignals: (stop: () => void) => () => void;
	readonly runLoop: typeof runContinuousFullHistoryLedgerCloseMetaLoop;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
	readonly wait: typeof waitForFullHistoryLedgerCloseMetaLoop;
}

const defaultDependencies: ContinuousFullHistoryLedgerCloseMetaCliDependencies =
	{
		acquireLeadership: acquireFullHistoryLedgerCloseMetaLeadership,
		compose: composeFullHistoryLedgerCloseMetaService,
		ensureRuntime: ensureFullHistoryLedgerCloseMetaRuntime,
		now: Date.now,
	reconcileRuntime: removeStaleFullHistoryLedgerCloseMetaArtifacts,
	resetOwnedRuntime: resetOwnedFullHistoryLedgerCloseMetaArtifacts,
		registerSignals,
		runLoop: runContinuousFullHistoryLedgerCloseMetaLoop,
		stderr: process.stderr,
		stdout: process.stdout,
		wait: waitForFullHistoryLedgerCloseMetaLoop
	};

export async function runContinuousFullHistoryLedgerCloseMetaCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: ContinuousFullHistoryLedgerCloseMetaCliDependencies = defaultDependencies
): Promise<number> {
	let config: FullHistoryLedgerCloseMetaServiceConfig;
	try {
		config = parseFullHistoryLedgerCloseMetaServiceConfig(environment);
	} catch (error) {
		writeEvent(dependencies.stderr, {
			event: 'runtime',
			message: safeMessage(error),
			status: 'refused'
		});
		return 64;
	}

	const abortController = new AbortController();
	const unregisterSignals = dependencies.registerSignals(() =>
		abortController.abort(new Error('shutdown requested'))
	);
	let composition: FullHistoryLedgerCloseMetaComposition | null = null;
	let leadership: FullHistoryLedgerCloseMetaLeadershipLease | null = null;
	let leadershipFailure: Error | null = null;
	let leadershipMonitor: Promise<void> | null = null;
	let runtimeCleanupFailure: Error | null = null;
	let runtimeCleanupMonitor: Promise<void> | null = null;
	let exitCode = 0;
	try {
		await dependencies.ensureRuntime(config);
		composition = dependencies.compose(config);
		const activeComposition = composition;
		await activeComposition.dataSource.initialize();
		await assertSchemaReady(activeComposition.dataSource);
		leadership = await dependencies.acquireLeadership(
			activeComposition.dataSource
		);
		if (!leadership.acquired) {
			writeEvent(dependencies.stderr, {
				event: 'runtime',
				status: 'leadership-unavailable'
			});
			exitCode = 75;
		} else {
			await leadership.assertHeld();
			await dependencies.resetOwnedRuntime(config);
			await dependencies.reconcileRuntime(config, dependencies.now());
			leadershipMonitor = monitorLeadership(
				leadership,
				abortController,
				dependencies.wait,
				(error) => {
					leadershipFailure = error;
				}
			);
			runtimeCleanupMonitor = monitorFullHistoryLedgerCloseMetaRuntimeCleanup(
				config,
				abortController,
				dependencies,
				(error) => {
					runtimeCleanupFailure = error;
				}
			);
			await dependencies.runLoop(
				{
					cycleLedgerCount: config.cycleLedgerCount,
					errorBackoffMilliseconds: config.errorBackoffMilliseconds,
					idlePollMilliseconds: config.idlePollMilliseconds,
					lastAvailableLedger: config.lastAvailableLedger,
					typedShardLedgerCount: config.typedShardLedgerCount
				},
				{
					emit: (event) => writeEvent(dependencies.stdout, event),
					ensureStorageCapacity: () =>
						activeComposition.storageBudget.assertCanAllocate(
							cycleOutputReservation(config)
						),
					formatError: safeMessage,
					frontier: activeComposition.frontier,
					ingestion: activeComposition.ingestion,
					now: dependencies.now,
					signal: abortController.signal,
					wait: dependencies.wait
				}
			);
			if (leadershipFailure !== null) throw leadershipFailure;
			if (runtimeCleanupFailure !== null) throw runtimeCleanupFailure;
			writeEvent(dependencies.stdout, {
				event: 'runtime',
				status: 'stopped'
			});
		}
	} catch (error) {
		if (
			leadershipFailure !== null ||
			runtimeCleanupFailure !== null ||
			!abortController.signal.aborted
		) {
			writeEvent(dependencies.stderr, {
				event: 'runtime',
				message: safeMessage(error),
				status: 'failed'
			});
			exitCode = 75;
		}
	} finally {
		if (!abortController.signal.aborted) {
			abortController.abort(new Error('runtime stopped'));
		}
		await leadershipMonitor;
		await runtimeCleanupMonitor;
		unregisterSignals();
		composition?.frontier.destroy();
		if (leadership !== null) {
			try {
				await leadership.release();
			} catch (error) {
				writeEvent(dependencies.stderr, {
					event: 'cleanup',
					message: safeMessage(error),
					status: 'failed'
				});
				exitCode = 75;
			}
		}
		if (composition?.dataSource.isInitialized) {
			try {
				await composition.dataSource.destroy();
			} catch (error) {
				writeEvent(dependencies.stderr, {
					event: 'cleanup',
					message: safeMessage(error),
					status: 'failed'
				});
				exitCode = 75;
			}
		}
	}
	return exitCode;
}

export async function monitorFullHistoryLedgerCloseMetaRuntimeCleanup(
	config: FullHistoryLedgerCloseMetaServiceConfig,
	abortController: AbortController,
	dependencies: Pick<
		ContinuousFullHistoryLedgerCloseMetaCliDependencies,
		'now' | 'reconcileRuntime' | 'wait'
	>,
	onFailure: (error: Error) => void
): Promise<void> {
	while (!abortController.signal.aborted) {
		try {
			await dependencies.wait(
				FULL_HISTORY_LEDGER_CLOSE_META_CLEANUP_INTERVAL_MILLISECONDS,
				abortController.signal
			);
		} catch {
			return;
		}
		try {
			await dependencies.reconcileRuntime(config, dependencies.now());
		} catch (cause) {
			const error = new Error(
				'Full-history LedgerCloseMeta transient cleanup failed',
				{ cause }
			);
			onFailure(error);
			abortController.abort(error);
			return;
		}
	}
}

async function monitorLeadership(
	lease: FullHistoryLedgerCloseMetaLeadershipLease,
	abortController: AbortController,
	wait: typeof waitForFullHistoryLedgerCloseMetaLoop,
	onLost: (error: Error) => void
): Promise<void> {
	while (!abortController.signal.aborted) {
		try {
			await wait(10_000, abortController.signal);
		} catch {
			return;
		}
		try {
			await lease.assertHeld();
		} catch (cause) {
			const error = new Error(
				'Full-history LedgerCloseMeta leadership was lost',
				{
					cause
				}
			);
			onLost(error);
			abortController.abort(error);
			return;
		}
	}
}

function cycleOutputReservation(
	config: FullHistoryLedgerCloseMetaServiceConfig
): bigint {
	const shardCount = BigInt(
		Math.ceil(config.cycleLedgerCount / config.typedShardLedgerCount)
	);
	return (
		shardCount *
		BigInt(FULL_HISTORY_LEDGER_CLOSE_META_MAXIMUM_OUTPUT_BYTES_PER_SHARD)
	);
}

async function assertSchemaReady(dataSource: DataSource): Promise<void> {
	const rows = await dataSource.query<
		Array<{
			readonly batch: string | null;
			readonly dataset: string | null;
			readonly source: string | null;
			readonly sourceObject: string | null;
			readonly watermark: string | null;
		}>
	>(
		`select
			to_regclass('full_history_ledger_close_meta_source')::text as "source",
			to_regclass('full_history_ledger_close_meta_batch')::text as "batch",
			to_regclass('full_history_ledger_close_meta_source_object')::text as "sourceObject",
			to_regclass('full_history_ledger_close_meta_dataset')::text as "dataset",
			to_regclass('full_history_ledger_close_meta_watermark')::text as "watermark"`
	);
	const row = rows[0];
	if (
		rows.length !== 1 ||
		row === undefined ||
		Object.values(row).some((value) => value === null)
	) {
		throw new Error('Full-history LedgerCloseMeta schema is not ready');
	}
}

function registerSignals(stop: () => void): () => void {
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	return () => {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
	};
}

function writeEvent(
	output: WritableOutput,
	event:
		| ContinuousFullHistoryLedgerCloseMetaEvent
		| Readonly<Record<string, unknown>>
): void {
	const encoded = JSON.stringify(event);
	output.write(`${encoded.slice(0, 4_096)}\n`);
}

function safeMessage(error: unknown): string {
	if (error instanceof Error) return error.message.slice(0, 1_024);
	return String(error).slice(0, 1_024);
}
