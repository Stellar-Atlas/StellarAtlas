interface HistoryArchiveCanonicalFirstEnvironment {
	readonly HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT?: string;
}

export function getHistoryArchiveCanonicalFirstRoot(
	environment: HistoryArchiveCanonicalFirstEnvironment = process.env
): string | null {
	const raw = environment.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
	if (raw === undefined) return null;
	const normalized = raw.trim().replace(/\/+$/, '');
	return normalized.length === 0 ? null : normalized;
}

export function historyArchiveCanonicalFirstScopeCteSql(
	canonicalRootSql: string
): string {
	return `canonical_scope as materialized (
		select exists (
			select 1
			from "history_archive_checkpoint_scan_cursor" canonical_cursor
			join "history_archive_state_snapshot" canonical_state
				on canonical_state."archiveUrlIdentity" =
					canonical_cursor."archiveUrlIdentity"
			where ${canonicalRootSql} is not null
				and canonical_cursor."archiveUrlIdentity" = ${canonicalRootSql}
				and (
					canonical_cursor."nextHistoricalCheckpointLedger" <=
						(
							floor((canonical_state."currentLedger" + 1)::numeric / 64)
							* 64 - 1
						)::integer
					or not exists (
						select 1
						from "history_archive_checkpoint_proof" canonical_proof
						where canonical_proof."archiveUrlIdentity" =
								${canonicalRootSql}
							and canonical_proof."checkpointLedger" =
								(
									floor(
										(canonical_state."currentLedger" + 1)::numeric / 64
									) * 64 - 1
								)::integer
							and canonical_proof.status = 'verified'
					)
				)
		) as incomplete
	)`;
}

export function historyArchiveCanonicalFirstAdmissionSql(
	archiveUrlIdentitySql: string,
	canonicalRootSql: string
): string {
	return `(${canonicalRootSql} is null
		or not (select incomplete from canonical_scope)
		or ${archiveUrlIdentitySql} = ${canonicalRootSql})`;
}
