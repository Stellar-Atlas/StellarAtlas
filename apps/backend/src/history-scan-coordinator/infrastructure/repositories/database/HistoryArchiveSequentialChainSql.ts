export function historyArchiveObjectOpenSequentialCohortSql(
	objectAlias: string
): string {
	return `(
        ${objectAlias}."checkpointLedger" is null
        or exists (
            select 1
            from "history_archive_checkpoint_scan_cursor" chain_cursor
            where chain_cursor."archiveUrlIdentity" =
                    ${objectAlias}."archiveUrlIdentity"
                and (
                    (
                        ${objectAlias}."objectType" <> 'bucket'
                        and ${objectAlias}."checkpointLedger" =
                            chain_cursor."nextHistoricalCheckpointLedger" - 64
                    )
                    or (
                        ${objectAlias}."objectType" = 'bucket'
                        and exists (
                            select 1
                            from "history_archive_checkpoint_bucket_dependency" dependency
                            where dependency."archiveUrlIdentity" =
                                    ${objectAlias}."archiveUrlIdentity"
                                and dependency."bucketHash" =
                                    ${objectAlias}."bucketHash"
                                and dependency."checkpointLedger" =
                                    chain_cursor."nextHistoricalCheckpointLedger" - 64
                        )
                    )
                )
        )
    )`;
}
