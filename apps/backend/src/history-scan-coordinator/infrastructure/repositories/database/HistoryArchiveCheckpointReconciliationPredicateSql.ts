import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export const reconciliationPredicateSql = `(
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

export const runtimeReconciliationPredicateSql = `(
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
