import { availableParallelism } from 'node:os';
import {
	calculateHistoryArchiveObjectWorkerProcesses,
	historyArchiveDownloadConcurrency,
	historyArchiveWorkerSlotLimit,
	resolveHistoryArchiveObjectWorkerCapacity
} from 'history-scanner-dto';

const maximumConfiguredHasherWorkers = historyArchiveWorkerSlotLimit - 1;
const maximumWorkerSlotsPerProcess = 24;

export interface HistoryArchiveObjectClusterPlan {
	readonly maximumActiveDownloads: number;
	readonly perProcessHasherWorkers: number;
	readonly processCount: number;
	readonly totalHasherWorkers: number;
	readonly workerSlotsPerProcess: number;
}

interface ClusterWorkerIdentity {
	readonly id: number;
}

export class HistoryArchiveObjectClusterSupervisor {
	private readonly slotsByWorkerId = new Map<
		number,
		{ readonly generation: number; readonly index: number }
	>();

	constructor(
		private readonly plan: HistoryArchiveObjectClusterPlan,
		private readonly env: NodeJS.ProcessEnv,
		private readonly forkProcess: (
			env: NodeJS.ProcessEnv
		) => ClusterWorkerIdentity
	) {}

	start(): void {
		for (let index = 0; index < this.plan.processCount; index++) {
			this.fork(index, 0);
		}
	}

	replace(exitedWorkerId: number): boolean {
		const exited = this.slotsByWorkerId.get(exitedWorkerId);
		if (exited === undefined) return false;

		this.slotsByWorkerId.delete(exitedWorkerId);
		this.fork(exited.index, exited.generation + 1);
		return true;
	}

	private fork(index: number, generation: number): void {
		const worker = this.forkProcess({
			...this.env,
			HISTORY_HASHER_WORKERS: String(this.plan.perProcessHasherWorkers),
			HISTORY_OBJECT_WORKER_GENERATION: String(generation),
			HISTORY_OBJECT_WORKER_INDEX: String(
				index * this.plan.workerSlotsPerProcess
			),
			HISTORY_OBJECT_WORKER_PROCESS_COUNT: String(this.plan.processCount),
			HISTORY_SCAN_WORKERS: String(this.plan.workerSlotsPerProcess)
		});
		this.slotsByWorkerId.set(worker.id, { generation, index });
	}
}

export function createHistoryArchiveObjectClusterPlan(
	env: NodeJS.ProcessEnv,
	cpuCount = availableParallelism()
): HistoryArchiveObjectClusterPlan {
	const totalWorkerSlots = resolveHistoryArchiveObjectWorkerCapacity(
		env,
		cpuCount
	).consumerCount;
	const processCount = readBoundedPositiveInteger(
		env,
		'HISTORY_OBJECT_CLUSTER_PROCESSES',
		totalWorkerSlots,
		totalWorkerSlots
	);
	if (totalWorkerSlots % processCount !== 0) {
		throw new Error(
			'HISTORY_OBJECT_CLUSTER_PROCESSES must evenly divide ' +
				'HISTORY_OBJECT_WORKER_PROCESSES'
		);
	}
	const workerSlotsPerProcess = totalWorkerSlots / processCount;
	if (workerSlotsPerProcess > maximumWorkerSlotsPerProcess) {
		throw new Error(
			`HISTORY_OBJECT_CLUSTER_PROCESSES must provide no more than ${maximumWorkerSlotsPerProcess} worker slots per process`
		);
	}
	const configuredHasherWorkers = readBoundedPositiveInteger(
		env,
		'HISTORY_HASHER_WORKERS',
		calculateHistoryArchiveObjectWorkerProcesses(cpuCount),
		maximumConfiguredHasherWorkers
	);
	const totalHasherWorkers = Math.max(configuredHasherWorkers, processCount);
	const maximumActiveDownloads = readBoundedPositiveInteger(
		env,
		'HISTORY_OBJECT_DOWNLOAD_CONCURRENCY',
		Math.min(historyArchiveDownloadConcurrency, totalWorkerSlots),
		Math.min(historyArchiveDownloadConcurrency, totalWorkerSlots)
	);

	return {
		maximumActiveDownloads,
		perProcessHasherWorkers: Math.max(
			Math.floor(totalHasherWorkers / processCount),
			1
		),
		processCount,
		totalHasherWorkers,
		workerSlotsPerProcess
	};
}

function readBoundedPositiveInteger(
	env: NodeJS.ProcessEnv,
	name: string,
	defaultValue: number,
	maximum: number
): number {
	const rawValue = env[name];
	if (rawValue === undefined || rawValue.trim() === '') return defaultValue;

	const parsed = Number(rawValue);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new Error(`${name} must be between 1 and ${maximum}`);
	}

	return parsed;
}
