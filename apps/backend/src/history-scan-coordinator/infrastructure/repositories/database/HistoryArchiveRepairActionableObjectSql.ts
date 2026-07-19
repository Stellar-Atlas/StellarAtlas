export function historyArchiveRepairActionableObjectSql(alias: string): string {
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
		throw new Error('Invalid history archive repair query alias');
	}
	const tableAlias = `"${alias}"`;
	const errorType = `replace(lower(coalesce(${tableAlias}."errorType", '')), '-', '_')`;
	return `
		(coalesce(${tableAlias}."failureChannel", 'archive_evidence') = 'archive_evidence')
		and (
			${tableAlias}."httpStatus" in (404, 410)
			or (
				(${tableAlias}."httpStatus" is null or ${tableAlias}."httpStatus" < 400)
				and lower(coalesce(${tableAlias}."errorMessage", '')) not like '%abort%'
				and (
					${errorType} like '%not_found%'
					or ${errorType} like '%enoent%'
					or ${errorType} like '%missing%'
					or ${errorType} like '%hash%'
					or ${errorType} like '%mismatch%'
					or ${errorType} in (
						'bucket_verification_failed',
						'category_content_invalid',
						'invalid_checkpoint_state',
						'invalid_history_archive_state'
					)
				)
			)
		)
	`;
}
