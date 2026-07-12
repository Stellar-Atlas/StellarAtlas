import type { Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { normalizeLimit } from './HistoryArchiveObjectRowMapper.js';

export async function findVerifiedCheckpointsNeedingReconciliation(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const mismatches = await baseCheckpointQuery(repository)
		.innerJoin(
			HistoryArchiveCheckpointProof,
			'proof',
			'proof.archiveUrlIdentity = object.archiveUrlIdentity and proof.checkpointLedger = object.checkpointLedger'
		)
		.andWhere('proof.status = :mismatchStatus', {
			mismatchStatus: 'mismatch'
		})
		.andWhere(
			`(
			"object"."dependenciesMaterializedAt" is null
			or "proof"."evaluatedAt" < "object"."dependenciesMaterializedAt"
		)`
		)
		.orderBy('object.id', 'ASC')
		.take(safeLimit)
		.getMany();
	if (mismatches.length >= safeLimit) return mismatches;

	const remaining = baseCheckpointQuery(repository).andWhere(`(
		"object"."dependenciesMaterializedAt" is null
		or not exists (
			select 1
			from history_archive_checkpoint_proof proof
			where proof."archiveUrlIdentity" = "object"."archiveUrlIdentity"
				and proof."checkpointLedger" = "object"."checkpointLedger"
				and proof."evaluatedAt" >= "object"."dependenciesMaterializedAt"
		)
	)`);
	if (mismatches.length > 0) {
		remaining.andWhere('object.remoteId not in (:...reconciledRemoteIds)', {
			reconciledRemoteIds: mismatches.map((object) => object.remoteId)
		});
	}

	return [
		...mismatches,
		...(await remaining
			.orderBy('object.id', 'ASC')
			.take(safeLimit - mismatches.length)
			.getMany())
	];
}

function baseCheckpointQuery(
	repository: Repository<HistoryArchiveObject>
): SelectQueryBuilder<HistoryArchiveObject> {
	return repository
		.createQueryBuilder('object')
		.where('object.objectType = :objectType', {
			objectType: 'checkpoint-state'
		})
		.andWhere('object.status = :status', { status: 'verified' });
}
