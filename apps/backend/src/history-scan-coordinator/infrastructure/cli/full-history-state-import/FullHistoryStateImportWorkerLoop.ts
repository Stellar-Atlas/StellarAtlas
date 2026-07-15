import type { FullHistoryStateImportReceipt } from '../../../domain/full-history-state-import/FullHistoryStateImport.js';

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
	) => Promise<FullHistoryStateImportReceipt | null>;
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
		let receipt: FullHistoryStateImportReceipt | null;
		try {
			receipt = await dependencies.execute(dependencies.signal);
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

		if (receipt === null) {
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

		dependencies.emit({
			at: new Date(dependencies.now()).toISOString(),
			batchId: receipt.batchId,
			dataset: receipt.dataset,
			durationMs: Math.max(0, dependencies.now() - startedAt),
			event: 'state-import',
			recordCount: receipt.recordCount.toString(),
			status: 'complete',
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
