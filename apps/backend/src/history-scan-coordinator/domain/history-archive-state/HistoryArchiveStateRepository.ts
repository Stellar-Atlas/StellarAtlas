import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type {
	HistoryArchiveStateFailureInput,
	HistoryArchiveStateSnapshot,
	HistoryArchiveStateSource
} from './HistoryArchiveStateSnapshot.js';

export interface HistoryArchiveStateRepository {
	findByUrl(url: string): Promise<HistoryArchiveStateSnapshot | null>;
	saveAvailable(
		archiveUrl: string,
		archiveMetadata: ArchiveMetadataDTO,
		source: HistoryArchiveStateSource
	): Promise<void>;
	saveFailure(input: Omit<HistoryArchiveStateFailureInput, 'archiveUrlIdentity'>): Promise<void>;
}
