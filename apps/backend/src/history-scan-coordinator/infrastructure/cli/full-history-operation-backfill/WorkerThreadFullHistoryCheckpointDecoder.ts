import { Worker } from 'node:worker_threads';
import type { FullHistoryCheckpointCandidate } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type {
	FullHistoryCheckpointDecoder,
	FullHistoryDecodedCheckpoint
} from '../../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import { validateFullHistoryOperationBackfillCpuWorkerCount } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import {
	serializeFullHistoryOperationDecodeWorkerRequest,
	type FullHistoryOperationDecodeWorkerRequest
} from './FullHistoryOperationWorkerCandidateCodec.js';
import {
	parseFullHistoryOperationWorkerResponse,
	type FullHistoryOperationWorkerMemory
} from './FullHistoryOperationWorkerProtocol.js';

export const FULL_HISTORY_OPERATION_WORKER_MAX_OLD_GENERATION_MB = 2_048;
export const FULL_HISTORY_OPERATION_WORKER_TASK_TIMEOUT_MS = 30 * 60 * 1_000;

export interface FullHistoryOperationWorkerMetrics {
	readonly activeWorkers: number;
	readonly completedTasks: number;
	readonly failedTasks: number;
	readonly peakActiveWorkers: number;
	readonly peakArrayBuffersBytes: number;
	readonly peakExternalBytes: number;
	readonly peakHeapUsedBytes: number;
	readonly queuedTasks: 0;
	readonly resourceLimitMb: number;
	readonly retryCount: 0;
	readonly workerCapacity: number;
}

export interface FullHistoryOperationWorkerHandle {
	onError(listener: (error: Error) => void): void;
	onExit(listener: (exitCode: number) => void): void;
	onMessage(listener: (value: unknown) => void): void;
	terminate(): Promise<number>;
}

export interface FullHistoryOperationWorkerFactory {
	create(
		request: FullHistoryOperationDecodeWorkerRequest
	): FullHistoryOperationWorkerHandle;
}

export class FullHistoryOperationDecodeWorkerError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'FullHistoryOperationDecodeWorkerError';
	}
}

export class WorkerThreadFullHistoryCheckpointDecoder implements FullHistoryCheckpointDecoder {
	readonly version = new StellarFullHistoryCheckpointDecoder().version;
	private activeWorkers = 0;
	private completedTasks = 0;
	private failedTasks = 0;
	private peakActiveWorkers = 0;
	private peakArrayBuffersBytes = 0;
	private peakExternalBytes = 0;
	private peakHeapUsedBytes = 0;

	constructor(
		private readonly workerCapacity: number,
		private readonly workerFactory: FullHistoryOperationWorkerFactory = new NodeFullHistoryOperationWorkerFactory(),
		private readonly taskTimeoutMs = FULL_HISTORY_OPERATION_WORKER_TASK_TIMEOUT_MS
	) {
		validateFullHistoryOperationBackfillCpuWorkerCount(workerCapacity);
		if (!Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1) {
			throw new RangeError('Worker task timeout must be a positive integer');
		}
	}

	async decode(
		candidate: FullHistoryCheckpointCandidate,
		networkPassphrase: string
	): Promise<FullHistoryDecodedCheckpoint> {
		if (this.activeWorkers >= this.workerCapacity) {
			throw new FullHistoryOperationDecodeWorkerError(
				'Operation decoder worker capacity exceeded; scheduler backpressure failed'
			);
		}
		this.activeWorkers += 1;
		this.peakActiveWorkers = Math.max(
			this.peakActiveWorkers,
			this.activeWorkers
		);

		let worker: FullHistoryOperationWorkerHandle;
		try {
			worker = this.workerFactory.create(
				serializeFullHistoryOperationDecodeWorkerRequest(
					candidate,
					networkPassphrase
				)
			);
		} catch (error) {
			this.activeWorkers -= 1;
			this.failedTasks += 1;
			throw new FullHistoryOperationDecodeWorkerError(
				'Operation decoder worker could not be started',
				{ cause: error }
			);
		}

		return new Promise<FullHistoryDecodedCheckpoint>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				finish(
					undefined,
					new FullHistoryOperationDecodeWorkerError(
						'Operation decoder worker exceeded its bounded task timeout'
					)
				);
			}, this.taskTimeoutMs);

			const finish = (
				decoded: FullHistoryDecodedCheckpoint | undefined,
				error: Error | undefined
			): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				void worker
					.terminate()
					.catch(() => undefined)
					.finally(() => {
						this.activeWorkers -= 1;
						if (error === undefined && decoded !== undefined) {
							this.completedTasks += 1;
							resolve(decoded);
						} else {
							this.failedTasks += 1;
							reject(
								error ??
									new FullHistoryOperationDecodeWorkerError(
										'Operation decoder worker returned no checkpoint'
									)
							);
						}
					});
			};

			worker.onMessage((value) => {
				try {
					const response = parseFullHistoryOperationWorkerResponse(value);
					this.observeMemory(response.memory);
					if (response.status === 'failed') {
						finish(
							undefined,
							new FullHistoryOperationDecodeWorkerError(response.message)
						);
						return;
					}
					finish(response.decoded, undefined);
				} catch (error) {
					finish(
						undefined,
						new FullHistoryOperationDecodeWorkerError(
							'Operation decoder worker returned an invalid response',
							{ cause: error }
						)
					);
				}
			});
			worker.onError((error) => {
				finish(
					undefined,
					new FullHistoryOperationDecodeWorkerError(
						'Operation decoder worker failed',
						{ cause: error }
					)
				);
			});
			worker.onExit((exitCode) => {
				if (exitCode !== 0 || !settled) {
					finish(
						undefined,
						new FullHistoryOperationDecodeWorkerError(
							`Operation decoder worker exited before completion (${exitCode})`
						)
					);
				}
			});
		});
	}

	metrics(): FullHistoryOperationWorkerMetrics {
		return {
			activeWorkers: this.activeWorkers,
			completedTasks: this.completedTasks,
			failedTasks: this.failedTasks,
			peakActiveWorkers: this.peakActiveWorkers,
			peakArrayBuffersBytes: this.peakArrayBuffersBytes,
			peakExternalBytes: this.peakExternalBytes,
			peakHeapUsedBytes: this.peakHeapUsedBytes,
			queuedTasks: 0,
			resourceLimitMb: FULL_HISTORY_OPERATION_WORKER_MAX_OLD_GENERATION_MB,
			retryCount: 0,
			workerCapacity: this.workerCapacity
		};
	}

	private observeMemory(memory: FullHistoryOperationWorkerMemory): void {
		this.peakArrayBuffersBytes = Math.max(
			this.peakArrayBuffersBytes,
			memory.arrayBuffersBytes
		);
		this.peakExternalBytes = Math.max(
			this.peakExternalBytes,
			memory.externalBytes
		);
		this.peakHeapUsedBytes = Math.max(
			this.peakHeapUsedBytes,
			memory.heapUsedBytes
		);
	}
}

class NodeFullHistoryOperationWorkerFactory implements FullHistoryOperationWorkerFactory {
	create(
		request: FullHistoryOperationDecodeWorkerRequest
	): FullHistoryOperationWorkerHandle {
		return new NodeFullHistoryOperationWorkerHandle(
			new Worker(
				new URL('./FullHistoryOperationDecodeWorker.js', import.meta.url),
				{
					execArgv: [],
					resourceLimits: {
						maxOldGenerationSizeMb:
							FULL_HISTORY_OPERATION_WORKER_MAX_OLD_GENERATION_MB
					},
					workerData: request
				}
			)
		);
	}
}

class NodeFullHistoryOperationWorkerHandle implements FullHistoryOperationWorkerHandle {
	constructor(private readonly worker: Worker) {}

	onError(listener: (error: Error) => void): void {
		this.worker.once('error', listener);
	}

	onExit(listener: (exitCode: number) => void): void {
		this.worker.once('exit', listener);
	}

	onMessage(listener: (value: unknown) => void): void {
		this.worker.once('message', listener);
	}

	terminate(): Promise<number> {
		return this.worker.terminate();
	}
}
