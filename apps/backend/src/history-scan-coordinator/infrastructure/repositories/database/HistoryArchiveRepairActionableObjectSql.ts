export function historyArchiveRepairActionableObjectSql(alias: string): string {
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
		throw new Error('Invalid history archive repair query alias');
	}
	const tableAlias = `"${alias}"`;
	const errorType = `replace(lower(coalesce(${tableAlias}."errorType", '')), '-', '_')`;
	return `
		(coalesce(${tableAlias}."failureChannel", 'archive_evidence') = 'archive_evidence')
		and (${tableAlias}."httpStatus" is null or ${tableAlias}."httpStatus" < 400)
		and lower(coalesce(${tableAlias}."errorMessage", '')) not like '%abort%'
		and ${errorType} !~ '(auth|unauthorized|forbidden|not_found|enoent|missing|rate_limit|too_many_requests|timeout|timedout|abort|http|status|econn|eai_|enotfound|network|socket|tls|transport|worker|scanner|coordinator|claim|lease)'
		and (
			${errorType} like '%hash%'
			or ${errorType} like '%mismatch%'
			or ${errorType} in (
				'bucket_verification_failed',
				'category_content_invalid',
				'invalid_checkpoint_state',
				'invalid_history_archive_state'
			)
		)
	`;
}
