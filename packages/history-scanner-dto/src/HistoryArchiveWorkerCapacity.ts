export const historyArchiveDownloadConcurrency = 96;
export const historyArchiveWorkerTelemetryLimit = 128;
export const historyArchiveWorkerSlotLimit = 32_768;
export const historyArchiveObjectWorkerProcessLimit = 96;

const historyObjectWorkerProcessesEnvironmentVariable =
	'HISTORY_OBJECT_WORKER_PROCESSES';

const reservedLogicalProcessors = 4;
const workerSchedulingQuantum = 8;

export function calculateHistoryArchiveObjectWorkerProcesses(
	cpuCount: number
): number {
	const normalizedCpuCount = Number.isFinite(cpuCount)
		? Math.max(1, Math.floor(cpuCount))
		: 1;
	const usableCpuCount = Math.max(
		1,
		normalizedCpuCount - reservedLogicalProcessors
	);

	if (usableCpuCount < workerSchedulingQuantum) return usableCpuCount;
	return (
		Math.floor(usableCpuCount / workerSchedulingQuantum) *
		workerSchedulingQuantum
	);
}

export function calculateHistoryArchiveObjectCoordinatorProcesses(
	cpuCount: number
): number {
	return calculateHistoryArchiveObjectWorkerProcesses(cpuCount);
}

export interface HistoryArchiveObjectWorkerCapacity {
	readonly canonicalReserveCount: number;
	readonly consumerCount: number;
	readonly maximumWatermark: number;
	readonly minimumWatermark: number;
}

export function resolveHistoryArchiveObjectWorkerCapacity(
	env: Readonly<Record<string, string | undefined>>,
	cpuCount: number
): HistoryArchiveObjectWorkerCapacity {
	const rawValue = env[historyObjectWorkerProcessesEnvironmentVariable];
	const consumerCount =
		rawValue === undefined || rawValue.trim() === ''
			? Math.min(
					calculateHistoryArchiveObjectCoordinatorProcesses(cpuCount),
					historyArchiveObjectWorkerProcessLimit
				)
			: parseConfiguredWorkerProcesses(rawValue);

	return {
		canonicalReserveCount: Math.min(
			consumerCount,
			Math.max(2, Math.floor(consumerCount / 2))
		),
		consumerCount,
		maximumWatermark: consumerCount * 10,
		minimumWatermark: consumerCount * 2
	};
}

function parseConfiguredWorkerProcesses(rawValue: string): number {
	const parsed = Number(rawValue);
	if (
		!Number.isInteger(parsed) ||
		parsed < 1 ||
		parsed > historyArchiveObjectWorkerProcessLimit
	) {
		throw new Error(
			`${historyObjectWorkerProcessesEnvironmentVariable} must be between 1 and ${historyArchiveObjectWorkerProcessLimit}`
		);
	}

	return parsed;
}
