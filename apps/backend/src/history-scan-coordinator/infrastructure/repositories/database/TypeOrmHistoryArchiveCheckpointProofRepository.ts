import { injectable } from 'inversify';
import type { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveCheckpointProofRefreshTarget,
	HistoryArchiveCheckpointProofRepository
} from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { historyArchiveCheckpointProofRefreshSql } from './HistoryArchiveCheckpointProofRefreshSql.js';
import { toHistoryArchiveCheckpointProofRefreshParams } from './HistoryArchiveCheckpointProofSqlInputs.js';

@injectable()
export class TypeOrmHistoryArchiveCheckpointProofRepository implements HistoryArchiveCheckpointProofRepository {
	constructor(private readonly dataSource: DataSource) {}

	async findActionableByArchiveUrlIdentity(
		archiveUrlIdentity: string,
		limit: number
	): Promise<readonly HistoryArchiveCheckpointProof[]> {
		return await this.dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.createQueryBuilder('proof')
			.where('proof.archiveUrlIdentity = :archiveUrlIdentity', {
				archiveUrlIdentity
			})
			.andWhere('proof.status in (:...statuses)', {
				statuses: ['mismatch']
			})
			.orderBy('proof.evaluatedAt', 'DESC')
			.addOrderBy('proof.checkpointLedger', 'DESC')
			.take(normalizeLimit(limit))
			.getMany();
	}

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

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 250;
	return Math.min(limit, 500);
}
