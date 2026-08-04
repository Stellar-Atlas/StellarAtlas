import type { Repository, SelectQueryBuilder } from 'typeorm';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
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

const runtimeReconciliationPredicateSql = `(
	${reconciliationPredicateSql}
	or exists (
		select 1
		from history_archive_checkpoint_proof runtime_proof
		where runtime_proof."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and runtime_proof."checkpointLedger" = "object"."checkpointLedger"
			and (
				runtime_proof."proofVersion" <
					${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
			)
	)
	or exists (
		select 1
		from history_archive_checkpoint_proof runtime_proof
		join history_archive_checkpoint_bucket_dependency dependency
			on dependency."archiveUrlIdentity" =
				runtime_proof."archiveUrlIdentity"
			and dependency."checkpointLedger" =
				runtime_proof."checkpointLedger"
		join history_archive_object_queue bucket
			on bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and bucket."objectType" = 'bucket'
			and bucket."bucketHash" = dependency."bucketHash"
			and bucket.status = 'verified'
		where runtime_proof."archiveUrlIdentity" =
			"object"."archiveUrlIdentity"
			and runtime_proof."checkpointLedger" = "object"."checkpointLedger"
			and greatest(
				coalesce(bucket."verifiedAt", '-infinity'::timestamptz),
				bucket."updatedAt"
			) > runtime_proof."evaluatedAt"
	)
)`;

export async function findVerifiedCheckpointsNeedingReconciliation(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const runtimeTargetLimit = Math.max(
		1,
		safeLimit - Math.ceil(safeLimit / 3)
	);
	const runtimeTargets = await findRuntimeTargets(
		repository,
		runtimeTargetLimit
	);
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

	const satisfiedBucketProofs = await findSatisfiedBucketProofs(
		repository,
		safeLimit - runtimeTargets.length - mismatches.length,
		[...runtimeTargets, ...mismatches]
	);
	if (
		runtimeTargets.length + mismatches.length + satisfiedBucketProofs.length >=
		safeLimit
	) {
		return [...runtimeTargets, ...mismatches, ...satisfiedBucketProofs];
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
	excludeObjects(proofReadyQuery, [
		...runtimeTargets,
		...mismatches,
		...satisfiedBucketProofs
	]);
	const proofReady = await proofReadyQuery
		.orderBy('object.id', 'ASC')
		.take(
			safeLimit -
				runtimeTargets.length -
				mismatches.length -
				satisfiedBucketProofs.length
		)
		.getMany();
	if (
		runtimeTargets.length +
			mismatches.length +
			satisfiedBucketProofs.length +
			proofReady.length >=
		safeLimit
	) {
		return [
			...runtimeTargets,
			...mismatches,
			...satisfiedBucketProofs,
			...proofReady
		];
	}

	const remaining = withReconciliationPredicate(
		baseCheckpointQuery(repository)
	);
	excludeObjects(remaining, [
		...runtimeTargets,
		...mismatches,
		...satisfiedBucketProofs,
		...proofReady
	]);

	return [
		...runtimeTargets,
		...mismatches,
		...satisfiedBucketProofs,
		...proofReady,
		...(await remaining
			.orderBy('object.id', 'ASC')
			.take(
				safeLimit -
					runtimeTargets.length -
					mismatches.length -
					satisfiedBucketProofs.length -
					proofReady.length
			)
			.getMany())
	];
}

async function findSatisfiedBucketProofs(
	repository: Repository<HistoryArchiveObject>,
	limit: number,
	excluded: readonly HistoryArchiveObject[]
): Promise<readonly HistoryArchiveObject[]> {
	if (limit <= 0) return [];
	const rows = (await repository.manager.query(satisfiedBucketProofsSql, [
		limit,
		excluded.map((object) => object.remoteId)
	])) as readonly RuntimeTargetRow[];
	return await loadCheckpointObjects(repository, rows);
}

async function findRuntimeTargets(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const rows = (await repository.manager.query(
		`with ${canonicalRuntimeTargetCtes},
		 runtime_object as materialized (
			select target.target_lane, candidate.*
			from runtime_target target
			join "history_archive_state_snapshot" state
				on state.status = 'available'
				and state."networkPassphrase" is not null
				and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
					target."network_passphrase_hash"
			cross join lateral (
				select queued.*
				from "history_archive_object_queue" queued
				where queued."archiveUrlIdentity" =
						state."archiveUrlIdentity"
					and queued."objectType" = 'checkpoint-state'
					and queued."checkpointLedger" = target.checkpoint_ledger
					and queued.status = 'verified'
				limit 1
			) candidate
		 )
		 select object."remoteId" as "remoteId"
		 from runtime_object object
		 where ${runtimeReconciliationPredicateSql}
		 order by case object.target_lane
			when 'forward' then 0 else 1 end,
			object.id
		 limit $1::integer`,
		[limit]
	)) as readonly RuntimeTargetRow[];
	return await loadCheckpointObjects(repository, rows);
}

async function loadCheckpointObjects(
	repository: Repository<HistoryArchiveObject>,
	rows: readonly RuntimeTargetRow[]
): Promise<readonly HistoryArchiveObject[]> {
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

const satisfiedBucketProofsSql = `
	with proof_candidates as materialized (
		select distinct on (proof."archiveUrlIdentity")
			proof."archiveUrlIdentity", proof."checkpointLedger"
		from history_archive_checkpoint_proof proof
		where proof.status = 'not-evaluable'
			and proof."failureKind" = 'bucket-missing'
			and proof."requiredObjectsComplete" = true
			and proof."proofFactsComplete" = true
		order by proof."archiveUrlIdentity", proof."checkpointLedger" desc
	), satisfied as materialized (
		select candidate.*
		from proof_candidates candidate
		where exists (
			select 1
			from "history_archive_checkpoint_bucket_dependency" expected
			where expected."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and expected."checkpointLedger" = candidate."checkpointLedger"
		)
		and not exists (
			select 1
			from "history_archive_checkpoint_bucket_dependency" expected
			where expected."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and expected."checkpointLedger" = candidate."checkpointLedger"
				and not exists (
					select 1
					from "history_archive_object_queue" bucket
					where bucket."archiveUrlIdentity" = expected."archiveUrlIdentity"
						and bucket."objectType" = 'bucket'
						and bucket."bucketHash" = expected."bucketHash"
						and bucket.status = 'verified'
						and bucket."verificationFacts"#>>
							'{bucketObject,matched}' = 'true'
						and lower(bucket."verificationFacts"#>>
							'{bucketObject,expectedBucketHash}') = expected."bucketHash"
						and bucket."verificationFacts"#>>
							'{bucketObject,sourceUrl}' = bucket."objectUrl"
				)
		)
	)
	select object."remoteId"
	from satisfied
	join "history_archive_object_queue" object
		on object."archiveUrlIdentity" = satisfied."archiveUrlIdentity"
		and object."checkpointLedger" = satisfied."checkpointLedger"
		and object."objectType" = 'checkpoint-state'
		and object.status = 'verified'
	where not (object."remoteId" = any($2::uuid[]))
	order by object.id
	limit $1::integer
`;

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
