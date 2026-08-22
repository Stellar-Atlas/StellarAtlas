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
import { historyArchiveCheckpointProofPendingSourceEnrichmentSql } from './HistoryArchiveCheckpointProofPostRefreshSql.js';
import { materializeNextCompactCheckpointPlan } from './HistoryArchiveCompactPlanning.js';

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
		await this.refresh(target);
	}

	async refreshForObject(object: HistoryArchiveObject): Promise<void> {
		await this.refresh({
			archiveUrlIdentity: object.archiveUrlIdentity,
			bucketHash: object.bucketHash,
			checkpointLedger: object.checkpointLedger,
			includeSuccessor: object.objectType === 'ledger'
		});
	}

	private async refresh(
		target: HistoryArchiveCheckpointProofRefreshTarget
	): Promise<void> {
		if (target.checkpointLedger == null && target.bucketHash == null) {
			return;
		}
		await this.dataSource.transaction(async (manager) => {
			await manager.query(`set local lock_timeout = '2s'`);
			await manager.query(`set local statement_timeout = '30s'`);
			await manager.query(historyArchiveCheckpointProofRefreshSql, [
				...toHistoryArchiveCheckpointProofRefreshParams(target)
			]);
			if (target.checkpointLedger != null) {
				// The monotonic upsert has already run. A current-version proof that
				// remains pending therefore also had a pending derived result; enrich
				// only its durable source links without changing proof evidence.
				await manager.query(
					historyArchiveCheckpointProofPendingSourceEnrichmentSql,
					[target.archiveUrlIdentity, target.checkpointLedger]
				);
				await materializeNextCompactCheckpointPlan(
					manager,
					target.archiveUrlIdentity,
					target.checkpointLedger
				);
			}
		});
	}
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 250;
	return Math.min(limit, 500);
}
