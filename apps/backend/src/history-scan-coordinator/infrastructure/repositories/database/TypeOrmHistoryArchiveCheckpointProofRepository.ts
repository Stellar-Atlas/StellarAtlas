import { injectable } from 'inversify';
import type { DataSource } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveCheckpointProofRefreshTarget,
	HistoryArchiveCheckpointProofRepository
} from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import {
	historyArchiveCheckpointProofRefreshSql,
	toHistoryArchiveCheckpointProofRefreshParams
} from './HistoryArchiveCheckpointProofRefreshSql.js';

@injectable()
export class TypeOrmHistoryArchiveCheckpointProofRepository implements HistoryArchiveCheckpointProofRepository {
	constructor(private readonly dataSource: DataSource) {}

	async refreshForArchiveCheckpoint(
		target: HistoryArchiveCheckpointProofRefreshTarget
	): Promise<void> {
		if (target.checkpointLedger == null && target.bucketHash == null) {
			return;
		}

		await this.dataSource.manager.query(
			historyArchiveCheckpointProofRefreshSql,
			[...toHistoryArchiveCheckpointProofRefreshParams(target)]
		);
	}

	async refreshForObject(object: HistoryArchiveObject): Promise<void> {
		await this.refreshForArchiveCheckpoint({
			archiveUrlIdentity: object.archiveUrlIdentity,
			bucketHash: object.bucketHash,
			checkpointLedger: object.checkpointLedger
		});
	}
}
