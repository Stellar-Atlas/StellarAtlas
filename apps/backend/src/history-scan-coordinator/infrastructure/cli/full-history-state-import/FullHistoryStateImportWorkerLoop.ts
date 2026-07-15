import type { FullHistoryStateImportReceipt } from '../../../domain/full-history-state-import/FullHistoryStateImport.js';
import type { FullHistoryStateCanonicalCoverageReceipt } from '../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';

export type FullHistoryStateWorkerReceipt =
	| {
			readonly kind: 'state-import';
			readonly receipt: FullHistoryStateImportReceipt;
	  }
	| {
			readonly kind: 'canonical-coverage';
			readonly receipt: FullHistoryStateCanonicalCoverageReceipt;
	  };

export interface FullHistoryStateImportWorkerLoopConfig {
	readonly errorBackoffMilliseconds: number;
	readonly idlePollMilliseconds: number;
}

export type FullHistoryStateImportWorkerEvent =
	| {
			readonly at: string;
			readonly batchId: string;
			readonly dataset: FullHistoryStateImportReceipt['dataset'];
			readonly durationMs: number;
			readonly event: 'state-import';
			readonly recordCount: string;
			readonly status: 'complete';
			readonly worker: number;
	  }
	| {
			readonly at: string;
			readonly batchId: string;
			readonly canonicalBatchCount: number;
			readonly durationMs: number;
			readonly event: 'canonical-coverage';
			readonly ledgerCount: number;
			readonly minimumProofVersion: number;
			readonly status: 'complete' | 'mismatch';
			readonly worker: number;
	  }
	| {
			readonly at: string;
			readonly event: 'worker-cycle';
			readonly retryInMs: number;
			readonly status: 'idle';
			readonly worker: number;
	  }
	| {
			readonly at: string;
			readonly event: 'worker-cycle';
			readonly message: string;
			readonly retryInMs: number;
			readonly status: 'failed';
			readonly worker: number;
	  };

export interface FullHistoryStateImportWorkerLoopDependencies {
	readonly emit: (event: FullHistoryStateImportWorkerEvent) => void;
	readonly execute: (
		signal: AbortSignal
	) => Promise<FullHistoryStateWorkerReceipt | null>;
	readonly formatError: (error: unknown) => string;
	readonly now: () => number;
	readonly signal: AbortSignal;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly workerIndex: number;
}

export async function runFullHistoryStateImportWorkerLoop(
	config: FullHistoryStateImportWorkerLoopConfig,
	dependencies: FullHistoryStateImportWorkerLoopDependencies
): Promise<void> {
	while (!dependencies.signal.aborted) {
		const startedAt = dependencies.now();
		let result: FullHistoryStateWorkerReceipt | null;
		try {
			result = await dependencies.execute(dependencies.signal);
		} catch (error) {
			if (dependencies.signal.aborted) return;
			dependencies.emit({
				at: new Date(dependencies.now()).toISOString(),
				event: 'worker-cycle',
				message: dependencies.formatError(error),
				retryInMs: config.errorBackoffMilliseconds,
				status: 'failed',
				worker: dependencies.workerIndex
			});
			await dependencies.wait(
				config.errorBackoffMilliseconds,
				dependencies.signal
			);
			continue;
		}

		if (result === null) {
			dependencies.emit({
				at: new Date(dependencies.now()).toISOString(),
				event: 'worker-cycle',
				retryInMs: config.idlePollMilliseconds,
				status: 'idle',
				worker: dependencies.workerIndex
			});
			await dependencies.wait(config.idlePollMilliseconds, dependencies.signal);
			continue;
		}

		const durationMs = Math.max(0, dependencies.now() - startedAt);
		if (result.kind === 'state-import') {
			dependencies.emit({
				at: new Date(dependencies.now()).toISOString(),
				batchId: result.receipt.batchId,
				dataset: result.receipt.dataset,
				durationMs,
				event: 'state-import',
				recordCount: result.receipt.recordCount.toString(),
				status: 'complete',
				worker: dependencies.workerIndex
			});
			continue;
		}
		dependencies.emit({
			at: new Date(dependencies.now()).toISOString(),
			batchId: result.receipt.batchId,
			canonicalBatchCount: result.receipt.canonicalBatchCount,
			durationMs,
			event: 'canonical-coverage',
			ledgerCount: result.receipt.ledgerCount,
			minimumProofVersion: result.receipt.minimumProofVersion,
			status: result.receipt.status,
			worker: dependencies.workerIndex
		});
	}
}

export function waitForFullHistoryStateImport(
	milliseconds: number,
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timeout = setTimeout(done, milliseconds);
		function done(): void {
			clearTimeout(timeout);
			signal.removeEventListener('abort', done);
			resolve();
		}
		signal.addEventListener('abort', done, { once: true });
	});
}
