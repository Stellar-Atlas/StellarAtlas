import type { Repository, SelectQueryBuilder } from 'typeorm';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { normalizeLimit } from './HistoryArchiveObjectRowMapper.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

interface RuntimeTargetRow {
	readonly remoteId: string;
}

const reconciliationPredicateSql = `(
	"object"."dependenciesMaterializedAt" is null
	or not exists (
		select 1
		from history_archive_checkpoint_proof proof
		cross join lateral (
			select greatest(
				proof."evaluatedAt",
				coalesce(
					"object"."proofReconciledAt",
					'-infinity'::timestamptz
				)
			) as watermark
		) freshness
		where proof."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and proof."checkpointLedger" = "object"."checkpointLedger"
			and freshness.watermark >= "object"."dependenciesMaterializedAt"
			and freshness.watermark >= "object"."updatedAt"
			and not exists (
				select 1
				from history_archive_object_queue proof_scope_input
				where proof_scope_input."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and proof_scope_input."checkpointLedger" =
						proof."checkpointLedger"
					and proof_scope_input."objectType" in (
						'checkpoint-state',
						'ledger',
						'transactions',
						'results',
						'scp'
					)
					and greatest(
						proof_scope_input."updatedAt",
						coalesce(
							proof_scope_input."verifiedAt",
							'-infinity'::timestamptz
						)
					) > freshness.watermark
			)
			and not exists (
				select 1
				from lateral (
					${historyArchiveCheckpointBucketDependenciesSql(
						'proof."archiveUrlIdentity"',
						'proof."checkpointLedger"'
					)}
				) dependency
				left join history_archive_object_queue bucket
					on bucket."archiveUrlIdentity" =
						dependency."archiveUrlIdentity"
					and bucket."objectType" = 'bucket'
					and bucket."objectKey" =
						'bucket:' || dependency."bucketHash"
				where dependency."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and dependency."checkpointLedger" =
						proof."checkpointLedger"
					and (
						dependency."createdAt" > freshness.watermark
						or greatest(
							bucket."updatedAt",
							coalesce(
								bucket."verifiedAt",
								'-infinity'::timestamptz
							)
						) > freshness.watermark
					)
			)
			and (
				proof."checkpointLedger" = 63
				or exists (
					select 1
					from history_archive_object_queue predecessor
					where predecessor."archiveUrlIdentity" =
						proof."archiveUrlIdentity"
						and predecessor."checkpointLedger" =
							proof."checkpointLedger" - 64
						and predecessor."objectType" = 'ledger'
						and predecessor.status = 'verified'
						and not (
							proof.status = 'pending'
							and proof."failureKind" = 'predecessor-missing'
						)
						and predecessor."verifiedAt" is not null
						and predecessor."verifiedAt" <= freshness.watermark
						and predecessor."updatedAt" <= freshness.watermark
				)
				or (
					proof.status = 'pending'
					and proof."failureKind" = 'predecessor-missing'
					and not exists (
						select 1
						from history_archive_object_queue predecessor
						where predecessor."archiveUrlIdentity" =
							proof."archiveUrlIdentity"
							and predecessor."checkpointLedger" =
								proof."checkpointLedger" - 64
							and predecessor."objectType" = 'ledger'
							and (
								predecessor.status = 'verified'
								or greatest(
									predecessor."updatedAt",
									coalesce(
										predecessor."verifiedAt",
										'-infinity'::timestamptz
									)
								) > freshness.watermark
							)
					)
				)
			)
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
		join lateral (
			${historyArchiveCheckpointBucketDependenciesSql(
				'runtime_proof."archiveUrlIdentity"',
				'runtime_proof."checkpointLedger"'
			)}
		) dependency
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
			) > greatest(
				runtime_proof."evaluatedAt",
				coalesce(
					"object"."proofReconciledAt",
					'-infinity'::timestamptz
				)
			)
	)
	or exists (
		select 1
		from history_archive_checkpoint_proof runtime_proof
		where runtime_proof."archiveUrlIdentity" =
			"object"."archiveUrlIdentity"
			and runtime_proof."checkpointLedger" =
				"object"."checkpointLedger"
			and runtime_proof.status = 'pending'
			and (
				(runtime_proof."checkpointStateObjectRemoteId" is null
					and exists (
						select 1 from "history_archive_object_queue" source
						where source."archiveUrlIdentity" =
							"object"."archiveUrlIdentity"
							and source."checkpointLedger" =
								"object"."checkpointLedger"
							and source."objectType" = 'checkpoint-state'
					))
				or (runtime_proof."ledgerObjectRemoteId" is null
					and exists (
						select 1 from "history_archive_object_queue" source
						where source."archiveUrlIdentity" =
							"object"."archiveUrlIdentity"
							and source."checkpointLedger" =
								"object"."checkpointLedger"
							and source."objectType" = 'ledger'
					))
				or (runtime_proof."transactionsObjectRemoteId" is null
					and exists (
						select 1 from "history_archive_object_queue" source
						where source."archiveUrlIdentity" =
							"object"."archiveUrlIdentity"
							and source."checkpointLedger" =
								"object"."checkpointLedger"
							and source."objectType" = 'transactions'
					))
				or (runtime_proof."resultsObjectRemoteId" is null
					and exists (
						select 1 from "history_archive_object_queue" source
						where source."archiveUrlIdentity" =
							"object"."archiveUrlIdentity"
							and source."checkpointLedger" =
								"object"."checkpointLedger"
							and source."objectType" = 'results'
					))
				or (runtime_proof."scpObjectRemoteId" is null
					and exists (
						select 1 from "history_archive_object_queue" source
						where source."archiveUrlIdentity" =
							"object"."archiveUrlIdentity"
							and source."checkpointLedger" =
								"object"."checkpointLedger"
							and source."objectType" = 'scp'
					))
			)
	)
)`;

export async function findVerifiedCheckpointsNeedingReconciliation(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const safeLimit = normalizeLimit(limit);
	const sequentialTargets = await findOpenSequentialCohortTargets(
		repository,
		safeLimit
	);
	if (sequentialTargets.length > 0) return sequentialTargets;

	const runtimeTargetLimit = Math.min(
		safeLimit - sequentialTargets.length,
		Math.max(1, safeLimit - Math.ceil(safeLimit / 3))
	);
	const sequentialRemoteIds = new Set(
		sequentialTargets.map((object) => object.remoteId)
	);
	const runtimeTargets = (
		await findRuntimeTargets(repository, runtimeTargetLimit)
	).filter((object) => !sequentialRemoteIds.has(object.remoteId));
	const priorityTargets = [...sequentialTargets, ...runtimeTargets];
	if (priorityTargets.length >= safeLimit) {
		return priorityTargets.slice(0, safeLimit);
	}

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
			or greatest(
				"proof"."evaluatedAt",
				coalesce(
					"object"."proofReconciledAt",
					'-infinity'::timestamptz
				)
			) < greatest(
				"object"."dependenciesMaterializedAt",
				"object"."updatedAt"
			)
		)`
		)
		.orderBy('object.id', 'ASC')
		.take(safeLimit - priorityTargets.length)
		.getMany();
	if (priorityTargets.length + mismatches.length >= safeLimit) {
		return [...priorityTargets, ...mismatches];
	}

	const satisfiedBucketProofs = await findSatisfiedBucketProofs(
		repository,
		safeLimit - priorityTargets.length - mismatches.length,
		[...priorityTargets, ...mismatches]
	);
	if (
		priorityTargets.length + mismatches.length + satisfiedBucketProofs.length >=
		safeLimit
	) {
		return [...priorityTargets, ...mismatches, ...satisfiedBucketProofs];
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
		...priorityTargets,
		...mismatches,
		...satisfiedBucketProofs
	]);
	const proofReady = await proofReadyQuery
		.orderBy('object.id', 'ASC')
		.take(
			safeLimit -
				priorityTargets.length -
				mismatches.length -
				satisfiedBucketProofs.length
		)
		.getMany();
	if (
		priorityTargets.length +
			mismatches.length +
			satisfiedBucketProofs.length +
			proofReady.length >=
		safeLimit
	) {
		return [
			...priorityTargets,
			...mismatches,
			...satisfiedBucketProofs,
			...proofReady
		];
	}

	const remaining = withReconciliationPredicate(
		baseCheckpointQuery(repository)
	);
	excludeObjects(remaining, [
		...priorityTargets,
		...mismatches,
		...satisfiedBucketProofs,
		...proofReady
	]);

	return [
		...priorityTargets,
		...mismatches,
		...satisfiedBucketProofs,
		...proofReady,
		...(await remaining
			.orderBy('object.id', 'ASC')
			.take(
				safeLimit -
					priorityTargets.length -
					mismatches.length -
					satisfiedBucketProofs.length -
					proofReady.length
			)
			.getMany())
	];
}

async function findOpenSequentialCohortTargets(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	return await withReconciliationPredicate(
		baseCheckpointQuery(repository).innerJoin(
			'history_archive_checkpoint_scan_cursor',
			'chainCursor',
			`"chainCursor"."archiveUrlIdentity" = "object"."archiveUrlIdentity"
				and "object"."checkpointLedger" =
					"chainCursor"."nextHistoricalCheckpointLedger" - 64`
		)
	)
		.orderBy('object.checkpointLedger', 'ASC')
		.addOrderBy('object.id', 'ASC')
		.take(limit)
		.getMany();
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
                        where not exists (
                                select 1
                                from "history_archive_checkpoint_proof" proof
                                join "history_archive_state_snapshot" proof_state
                                        on proof_state."archiveUrlIdentity" =
                                                proof."archiveUrlIdentity"
                                        and proof_state.status = $$available$$
                                        and proof_state."networkPassphrase" is not null
                                        and sha256(convert_to(
                                                proof_state."networkPassphrase",
                                                $$UTF8$$
                                        )) = target."network_passphrase_hash"
                                where proof."checkpointLedger" =
                                                target.checkpoint_ledger
                                        and proof.status = $$verified$$
                                        and proof."failureKind" is null
                                        and proof."requiredObjectsComplete" = true
                                        and proof."proofFactsComplete" = true
                                        and proof."proofVersion" =
                                                ${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
                        )
                 )
		 select object."remoteId" as "remoteId"
		 from runtime_object object
		 where (
			object."transitionEffectsRequiredAt" is null
			or object."transitionEffectsCompletedAt" is not null
		 )
		 and ${runtimeReconciliationPredicateSql}
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
			from lateral (
				${historyArchiveCheckpointBucketDependenciesSql(
					'candidate."archiveUrlIdentity"',
					'candidate."checkpointLedger"'
				)}
			) expected
			where expected."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and expected."checkpointLedger" = candidate."checkpointLedger"
		)
		and not exists (
			select 1
			from lateral (
				${historyArchiveCheckpointBucketDependenciesSql(
					'candidate."archiveUrlIdentity"',
					'candidate."checkpointLedger"'
				)}
			) expected
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
		and (
			object."transitionEffectsRequiredAt" is null
			or object."transitionEffectsCompletedAt" is not null
		)
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
		.andWhere('object.status = :status', { status: 'verified' }).andWhere(`(
			object."transitionEffectsRequiredAt" is null
			or object."transitionEffectsCompletedAt" is not null
		)`);
}
