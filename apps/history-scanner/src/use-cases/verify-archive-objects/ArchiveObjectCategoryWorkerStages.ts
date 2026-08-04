import type { HistoryArchiveWorkerStageDTO } from 'history-scanner-dto';
import type { HistoryArchiveObjectJobDTO } from '../../domain/scan/ScanCoordinatorService.js';

export interface ArchiveObjectCategoryWorkerStages {
	readonly downloading: HistoryArchiveWorkerStageDTO;
	readonly fetching: HistoryArchiveWorkerStageDTO;
	readonly processing: HistoryArchiveWorkerStageDTO;
	readonly verified: HistoryArchiveWorkerStageDTO;
}

export function getCategoryWorkerStages(
	objectType: HistoryArchiveObjectJobDTO['objectType']
): ArchiveObjectCategoryWorkerStages | null {
	switch (objectType) {
		case 'ledger':
			return {
				downloading: 'downloading_ledger',
				fetching: 'fetching_ledger',
				processing: 'processing_ledger',
				verified: 'verified_ledger'
			};
		case 'transactions':
			return {
				downloading: 'downloading_transactions',
				fetching: 'fetching_transactions',
				processing: 'processing_transactions',
				verified: 'verified_transactions'
			};
		case 'results':
			return {
				downloading: 'downloading_results',
				fetching: 'fetching_results',
				processing: 'processing_results',
				verified: 'verified_results'
			};
		case 'scp':
			return {
				downloading: 'downloading_scp',
				fetching: 'fetching_scp',
				processing: 'processing_scp',
				verified: 'verified_scp'
			};
		default:
			return null;
	}
}
