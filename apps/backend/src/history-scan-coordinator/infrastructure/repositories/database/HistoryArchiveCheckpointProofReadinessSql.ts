import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export function historyArchiveCheckpointProofTerminalReadySql(
	targetAlias: string,
	requirePredecessorProof = true
): string {
	const archiveUrlIdentity = `${targetAlias}."archiveUrlIdentity"`;
	const checkpointLedger = `${targetAlias}."checkpointLedger"`;

	const predecessorReadySql = `(
            ${checkpointLedger} = 63
            or exists (
                select 1
                from "history_archive_checkpoint_proof" predecessor_proof
                where predecessor_proof."archiveUrlIdentity" = ${archiveUrlIdentity}
                    and predecessor_proof."checkpointLedger" = ${checkpointLedger} - 64
                    and predecessor_proof.status = 'verified'
            )
            or exists (
                select 1
                from "history_archive_checkpoint_substitution" predecessor_substitution
                where predecessor_substitution."archiveUrlIdentity" = ${archiveUrlIdentity}
                    and predecessor_substitution."checkpointLedger" = ${checkpointLedger} - 64
            )
        )`;

	return `(
        ${requirePredecessorProof ? predecessorReadySql : 'true'}
        and (
            exists (
                select 1
                from "history_archive_object_queue" failed
                where failed."archiveUrlIdentity" = ${archiveUrlIdentity}
                    and failed."checkpointLedger" = ${checkpointLedger}
                    and failed."objectType" in (
                        'checkpoint-state', 'ledger', 'transactions', 'results'
                    )
                    and failed.status = 'failed'
            )
            or exists (
                select 1
                from lateral (
                    ${historyArchiveCheckpointBucketDependenciesSql(
											archiveUrlIdentity,
											checkpointLedger
										)}
                ) dependency
                join "history_archive_object_queue" failed_bucket
                    on failed_bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
                    and failed_bucket."objectType" = 'bucket'
                    and failed_bucket."bucketHash" = dependency."bucketHash"
                    and failed_bucket.status = 'failed'
                where dependency."archiveUrlIdentity" = ${archiveUrlIdentity}
                    and dependency."checkpointLedger" = ${checkpointLedger}
            )
            or (
                not exists (
                    select 1
                    from (values
                        ('checkpoint-state'::text),
                        ('ledger'::text),
                        ('transactions'::text),
                        ('results'::text)
                    ) required("objectType")
                    where not exists (
                        select 1
                        from "history_archive_object_queue" object
                        where object."archiveUrlIdentity" = ${archiveUrlIdentity}
                            and object."checkpointLedger" = ${checkpointLedger}
                            and object."objectType" = required."objectType"
                            and object.status = 'verified'
                            and (
                                object."transitionEffectsRequiredAt" is null
                                or object."transitionEffectsCompletedAt" is not null
                            )
                    )
                )
                and exists (
                    select 1
                    from lateral (
                    ${historyArchiveCheckpointBucketDependenciesSql(
											archiveUrlIdentity,
											checkpointLedger
										)}
                ) dependency
                    where dependency."archiveUrlIdentity" = ${archiveUrlIdentity}
                        and dependency."checkpointLedger" = ${checkpointLedger}
                )
                and not exists (
                    select 1
                    from lateral (
                    ${historyArchiveCheckpointBucketDependenciesSql(
											archiveUrlIdentity,
											checkpointLedger
										)}
                ) dependency
                    where dependency."archiveUrlIdentity" = ${archiveUrlIdentity}
                        and dependency."checkpointLedger" = ${checkpointLedger}
                        and not exists (
                            select 1
                            from "history_archive_object_queue" bucket
                            where bucket."archiveUrlIdentity" = dependency."archiveUrlIdentity"
                                and bucket."objectType" = 'bucket'
                                and bucket."bucketHash" = dependency."bucketHash"
                                and bucket.status = 'verified'
                                and (
                                    bucket."transitionEffectsRequiredAt" is null
                                    or bucket."transitionEffectsCompletedAt" is not null
                                )
                        )
                )
            )
        )
    )`;
}

export function historyArchiveCheckpointProofEvidenceTerminalSql(
	targetAlias: string
): string {
	return historyArchiveCheckpointProofTerminalReadySql(targetAlias, false);
}
