import type {
	ArchiveWorkerStageDTO,
	ArchiveWorkerStatusRowDTO
} from '@api/types';

const permitHoldingStages = new Set<ArchiveWorkerStageDTO>([
	'fetching_history_archive_state',
	'fetching_checkpoint_state',
	'fetching_ledger',
	'downloading_ledger',
	'processing_ledger',
	'fetching_transactions',
	'downloading_transactions',
	'processing_transactions',
	'fetching_results',
	'downloading_results',
	'processing_results',
	'fetching_scp',
	'downloading_scp',
	'processing_scp',
	'fetching_bucket',
	'downloading_bucket',
	'verifying_bucket'
]);

interface ArchiveDownloadActivity {
	readonly activeDownloads: number;
	readonly waitingForDownloadSlots: number;
}

export function getArchiveDownloadActivity(
	workers: readonly ArchiveWorkerStatusRowDTO[]
): ArchiveDownloadActivity {
	let activeDownloads = 0;
	let waitingForDownloadSlots = 0;
	for (const worker of workers) {
		if (worker.status === 'stale') continue;
		if (worker.stage === 'waiting_for_download_slot') {
			waitingForDownloadSlots += 1;
			continue;
		}
		if (
			worker.currentObject !== null &&
			permitHoldingStages.has(worker.stage)
		) {
			activeDownloads += 1;
		}
	}

	return { activeDownloads, waitingForDownloadSlots };
}
