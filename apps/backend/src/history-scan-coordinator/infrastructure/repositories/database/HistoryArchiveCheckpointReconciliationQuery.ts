import type { Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { normalizeLimit } from './HistoryArchiveObjectRowMapper.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';

interface RuntimeTargetRow {
	readonly remoteId: string;
}

const reconciliationPredicateSql = `(
	"object"."dependenciesMaterializedAt" is null
	or not exists (
		select 1 from history_archive_checkpoint_proof proof
		where proof."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and proof."checkpointLedger" = "object"."checkpointLedger"
			and proof."evaluatedAt" >= "object"."dependenciesMaterializedAt"
	)
)`;

export async function findVerifiedCheckpointsNeedingReconciliation(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const runtimeTargets = await findRuntimeTargets(repository, safeLimit);
	if (runtimeTargets.length >= safeLimit) return runtimeTargets;

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
		.take(safeLimit - runtimeTargets.length)
		.getMany();
	if (runtimeTargets.length + mismatches.length >= safeLimit) {
		return [...runtimeTargets, ...mismatches];
	}

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
	excludeObjects(proofReadyQuery, [...runtimeTargets, ...mismatches]);
	const proofReady = await proofReadyQuery
		.orderBy('object.id', 'ASC')
		.take(safeLimit - runtimeTargets.length - mismatches.length)
		.getMany();
	if (
		runtimeTargets.length + mismatches.length + proofReady.length >=
		safeLimit
	) {
		return [...runtimeTargets, ...mismatches, ...proofReady];
	}

	const remaining = withReconciliationPredicate(
		baseCheckpointQuery(repository)
	);
	excludeObjects(remaining, [...runtimeTargets, ...mismatches, ...proofReady]);

	return [
		...runtimeTargets,
		...mismatches,
		...proofReady,
		...(await remaining
			.orderBy('object.id', 'ASC')
			.take(
				safeLimit -
					runtimeTargets.length -
					mismatches.length -
					proofReady.length
			)
			.getMany())
	];
}

async function findRuntimeTargets(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const rows = (await repository.manager.query(
		`with ${canonicalRuntimeTargetCtes}
		 select object."remoteId" as "remoteId"
		 from runtime_target target
		 join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				target."network_passphrase_hash"
		 join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = state."archiveUrlIdentity"
			and object."objectType" = 'checkpoint-state'
			and object."checkpointLedger" = target.checkpoint_ledger
			and object.status = 'verified'
		 where ${reconciliationPredicateSql}
		 order by case target.target_lane
			when 'forward' then 0 else 1 end,
			object.id
		 limit $1::integer`,
		[limit]
	)) as readonly RuntimeTargetRow[];
	if (rows.length === 0) return [];

	const objects = await baseCheckpointQuery(repository)
		.andWhere('object.remoteId in (:...runtimeTargetIds)', {
			runtimeTargetIds: rows.map((row) => row.remoteId)
		})
		.getMany();
	const byRemoteId = new Map(
		objects.map((object) => [object.remoteId, object])
	);
	return rows.flatMap((row) => {
		const object = byRemoteId.get(row.remoteId);
		return object === undefined ? [] : [object];
	});
}

function withReconciliationPredicate(
	query: SelectQueryBuilder<HistoryArchiveObject>
): SelectQueryBuilder<HistoryArchiveObject> {
	return query.andWhere(reconciliationPredicateSql);
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
