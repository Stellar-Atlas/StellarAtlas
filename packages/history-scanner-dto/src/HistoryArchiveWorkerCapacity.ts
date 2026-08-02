export const historyArchiveDownloadConcurrency = 8;
export const historyArchiveWorkerSlotLimit = 32_768;

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
	return Math.floor(usableCpuCount / workerSchedulingQuantum) * workerSchedulingQuantum;
}
