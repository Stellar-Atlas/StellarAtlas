function executableCanonicalReserveSql(objectAlias: string): string {
	return `${objectAlias}."executionDisposition" = 'executable'
		and ${objectAlias}."executionReason" = 'canonical-frontier-reserve'`;
}

function exactCheckpointObjectExistsSql(
	runtimeRootAlias: string,
	objectType: 'checkpoint-state' | 'ledger' | 'results' | 'transactions',
	checkpointLedgerSql: string
): string {
	return `exists (
		select 1
		from "history_archive_object_queue" selected
		where selected."archiveUrlIdentity" =
				${runtimeRootAlias}."archiveUrlIdentity"
			and selected."checkpointLedger" = ${checkpointLedgerSql}
			and selected."objectType" = '${objectType}'
			and selected."objectKey" = '${objectType}:' || lpad(
				to_hex(${checkpointLedgerSql}), 8, '0'
			)
			and ${executableCanonicalReserveSql('selected')}
	)`;
}

function exactBucketDependencyExistsSql(runtimeRootAlias: string): string {
	return `exists (
		select 1
		from "history_archive_checkpoint_bucket_dependency_current" dependency
		join "history_archive_object_queue" selected
			on selected."archiveUrlIdentity" =
				dependency."archiveUrlIdentity"
			and selected."bucketHash" = dependency."bucketHash"
			and selected."objectType" = 'bucket'
			and selected."objectKey" = 'bucket:' || dependency."bucketHash"
		where dependency."archiveUrlIdentity" =
				${runtimeRootAlias}."archiveUrlIdentity"
			and dependency."checkpointLedger" =
				${runtimeRootAlias}.checkpoint_ledger
			and ${executableCanonicalReserveSql('selected')}
	)`;
}

/**
 * The membership predicates intentionally stay in separate EXISTS branches.
 * PostgreSQL can then make exact checkpoint-index probes and drive bucket
 * membership from the dependency primary key, rather than expanding the
 * canonical membership OR across the full object table.
 */
export function canonicalRuntimeExecutableProofMemberExistsSql(
	runtimeRootAlias: string
): string {
	const currentCheckpoint = `${runtimeRootAlias}.checkpoint_ledger`;
	const previousCheckpoint = `${runtimeRootAlias}.checkpoint_ledger - 64`;
	return `(
		${exactCheckpointObjectExistsSql(
			runtimeRootAlias,
			'checkpoint-state',
			currentCheckpoint
		)}
		or (
			${runtimeRootAlias}.checkpoint_phase_ready
			and (
				${exactCheckpointObjectExistsSql(
					runtimeRootAlias,
					'checkpoint-state',
					previousCheckpoint
				)}
				or ${exactCheckpointObjectExistsSql(
					runtimeRootAlias,
					'ledger',
					currentCheckpoint
				)}
				or ${exactCheckpointObjectExistsSql(
					runtimeRootAlias,
					'ledger',
					previousCheckpoint
				)}
				or ${exactCheckpointObjectExistsSql(
					runtimeRootAlias,
					'transactions',
					currentCheckpoint
				)}
				or ${exactCheckpointObjectExistsSql(
					runtimeRootAlias,
					'results',
					currentCheckpoint
				)}
				or ${exactBucketDependencyExistsSql(runtimeRootAlias)}
			)
		)
	)`;
}
