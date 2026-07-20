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

const runtimeProofInputsCompleteSql = `(
	(select count(*)
	 from history_archive_object_queue required
	 where required."archiveUrlIdentity" = "object"."archiveUrlIdentity"
		and required."checkpointLedger" = "object"."checkpointLedger"
		and required."objectType" in (
			'checkpoint-state', 'ledger', 'transactions', 'results'
		)) = 4
	and (select count(distinct required."objectType")
	 from history_archive_object_queue required
	 where required."archiveUrlIdentity" = "object"."archiveUrlIdentity"
		and required."checkpointLedger" = "object"."checkpointLedger"
		and required."objectType" in (
			'checkpoint-state', 'ledger', 'transactions', 'results'
		)
		and required.status = 'verified') = 4
	and ("object"."checkpointLedger" = 63 or (
		select count(*)
		from history_archive_object_queue predecessor
		where predecessor."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and predecessor."checkpointLedger" = "object"."checkpointLedger" - 64
			and predecessor."objectType" = 'ledger'
			and predecessor.status = 'verified'
	) = 1)
	and exists (
		select 1
		from history_archive_checkpoint_bucket_dependency dependency
		where dependency."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and dependency."checkpointLedger" = "object"."checkpointLedger"
	)
	and not exists (
		select 1
		from history_archive_checkpoint_bucket_dependency dependency
		where dependency."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and dependency."checkpointLedger" = "object"."checkpointLedger"
			and not exists (
				select 1
				from history_archive_object_queue bucket
				where bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
					and bucket."objectType" = 'bucket'
					and bucket."bucketHash" = dependency."bucketHash"
					and bucket.status = 'verified'
					and bucket."verificationFacts"#>>'{bucketObject,matched}' = 'true'
					and lower(bucket."verificationFacts"#>>
						'{bucketObject,expectedBucketHash}') = dependency."bucketHash"
					and bucket."verificationFacts"#>>'{bucketObject,sourceUrl}' =
						bucket."objectUrl"
			)
	)
)`;

const runtimeProofEvidenceChangedSql = `(
	coalesce("object"."dependenciesMaterializedAt", '-infinity'::timestamptz) >
		runtime_proof."evaluatedAt"
	or exists (
		select 1
		from history_archive_object_queue changed
		where changed."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and greatest(
				coalesce(changed."verifiedAt", '-infinity'::timestamptz),
				coalesce(changed."transitionEffectsRequiredAt",
					'-infinity'::timestamptz),
				changed."updatedAt"
			) > runtime_proof."evaluatedAt"
			and (
				(changed."checkpointLedger" = "object"."checkpointLedger"
					and changed."objectType" in (
						'checkpoint-state', 'ledger', 'transactions', 'results'
					))
				or (changed."checkpointLedger" = "object"."checkpointLedger" - 64
					and changed."objectType" = 'ledger')
			)
	)
	or exists (
		select 1
		from history_archive_checkpoint_bucket_dependency dependency
		join history_archive_object_queue changed
			on changed."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and changed."objectType" = 'bucket'
			and changed."bucketHash" = dependency."bucketHash"
		where dependency."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and dependency."checkpointLedger" = "object"."checkpointLedger"
			and greatest(
				coalesce(changed."verifiedAt", '-infinity'::timestamptz),
				coalesce(changed."transitionEffectsRequiredAt",
					'-infinity'::timestamptz),
				changed."updatedAt"
			) > runtime_proof."evaluatedAt"
	)
	or exists (
		select 1
		from history_archive_checkpoint_bucket_dependency dependency
		where dependency."archiveUrlIdentity" = "object"."archiveUrlIdentity"
			and dependency."checkpointLedger" = "object"."checkpointLedger"
			and dependency."createdAt" > runtime_proof."evaluatedAt"
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
				or (
					runtime_proof.status in ('pending', 'not-evaluable')
					and ${runtimeProofInputsCompleteSql}
					and ${runtimeProofEvidenceChangedSql}
				)
			)
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
