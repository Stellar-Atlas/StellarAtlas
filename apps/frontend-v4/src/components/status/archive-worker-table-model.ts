import { historyArchiveWorkerTelemetryLimit } from 'history-scanner-dto';
import type { ArchiveWorkerStatusRowDTO, PublicWorkerStatus } from '@api/types';
import { formatInteger } from '@format/formatters';

export const archiveWorkerPageSize = 8;
export type ArchiveWorkerSlot = {
	readonly slotIndex: number;
	readonly worker: ArchiveWorkerStatusRowDTO | null;
};
const MAX_ARCHIVE_WORKER_SLOTS = historyArchiveWorkerTelemetryLimit;

export function createWorkerSlots(
	workers: readonly ArchiveWorkerStatusRowDTO[],
	configuredWorkerProcesses: number
): readonly ArchiveWorkerSlot[] {
	const configuredSlots = Math.min(
		MAX_ARCHIVE_WORKER_SLOTS,
		Math.max(0, configuredWorkerProcesses)
	);
	const workersBySlot = new Map<number, ArchiveWorkerStatusRowDTO>();
	for (const worker of workers) {
		if (
			worker.slotIndex < configuredSlots &&
			!workersBySlot.has(worker.slotIndex)
		) {
			workersBySlot.set(worker.slotIndex, worker);
		}
	}
	return Array.from({ length: configuredSlots }, (_, slotIndex) => ({
		slotIndex,
		worker: workersBySlot.get(slotIndex) ?? null
	}));
}

export function formatArchiveWorkerCapacity(
	archive: PublicWorkerStatus['archiveWorkers']
): string {
	const slots =
		formatInteger(archive.configuredWorkerProcesses) +
		' configured worker slots';
	if (archive.telemetryMode === 'aggregate-only')
		return slots + '; process count unavailable';
	const processCount = new Set(
		archive.workers.map((worker) => worker.processId)
	).size;
	return (
		slots +
		'; ' +
		formatInteger(processCount) +
		' observed process' +
		(processCount === 1 ? '' : 'es')
	);
}
