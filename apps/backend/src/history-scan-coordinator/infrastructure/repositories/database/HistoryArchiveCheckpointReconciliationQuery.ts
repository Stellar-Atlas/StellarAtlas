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

	const proofReadyQuery = withReconciliationPredicate(
		baseCheckpointQuery(repository)
			.innerJoin(
				HistoryArchiveCheckpointProof,
				'candidateProof',
				'candidateProof.archiveUrlIdentity = object.archiveUrlIdentity and candidateProof.checkpointLedger = object.checkpointLedger'
			)
			.andWhere('candidateProof.status = :proofReadyStatus', {
				proofReadyStatus: 'not-evaluable'
			})
			.andWhere('candidateProof.failureKind = :proofReadyFailure', {
				proofReadyFailure: 'bucket-missing'
			})
			.andWhere('candidateProof.requiredObjectsComplete = true')
			.andWhere('candidateProof.proofFactsComplete = true')
	);
	excludeObjects(proofReadyQuery, mismatches);
	const proofReady = await proofReadyQuery
		.orderBy('object.id', 'ASC')
		.take(safeLimit - mismatches.length)
		.getMany();
	if (mismatches.length + proofReady.length >= safeLimit) {
		return [...mismatches, ...proofReady];
	}

	const remaining = withReconciliationPredicate(
		baseCheckpointQuery(repository)
	);
	excludeObjects(remaining, [...mismatches, ...proofReady]);

	return [
		...mismatches,
		...proofReady,
		...(await remaining
			.orderBy('object.id', 'ASC')
			.take(safeLimit - mismatches.length - proofReady.length)
			.getMany())
	];
}

function withReconciliationPredicate(
	query: SelectQueryBuilder<HistoryArchiveObject>
): SelectQueryBuilder<HistoryArchiveObject> {
	return query.andWhere(`(
		"object"."dependenciesMaterializedAt" is null
		or not exists (
			select 1 from history_archive_checkpoint_proof proof
			where proof."archiveUrlIdentity" = "object"."archiveUrlIdentity"
				and proof."checkpointLedger" = "object"."checkpointLedger"
				and proof."evaluatedAt" >= "object"."dependenciesMaterializedAt"
		)
	)`);
}

function excludeObjects(
	query: SelectQueryBuilder<HistoryArchiveObject>,
	objects: readonly HistoryArchiveObject[]
): void {
	if (objects.length === 0) return;
	query.andWhere('object.remoteId not in (:...reconciledRemoteIds)', {
		reconciledRemoteIds: objects.map((object) => object.remoteId)
	});
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
