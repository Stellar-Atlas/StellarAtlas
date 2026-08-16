export function historyArchiveRepairActionableObjectSql(alias: string): string {
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
		throw new Error('Invalid history archive repair query alias');
	}
	const tableAlias = `"${alias}"`;
	const errorType = `replace(lower(coalesce(${tableAlias}."errorType", '')), '-', '_')`;
	const evidenceChannel = `coalesce(${tableAlias}."failureChannel", 'archive_evidence')`;
	const integrityFailure = `
		(${tableAlias}."httpStatus" is null or ${tableAlias}."httpStatus" < 400)
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
		)`;
	const missingFailure = `
		(
			${tableAlias}."httpStatus" in (404, 410)
			or (
				(${tableAlias}."httpStatus" is null or ${tableAlias}."httpStatus" < 400)
				and ${errorType} ~ '(not_found|enoent|missing)'
				and ${errorType} !~ '(auth|unauthorized|forbidden|rate_limit|too_many_requests|timeout|timedout|abort|http|status|econn|eai_|enotfound|network|socket|tls|transport|worker|scanner|coordinator|claim|lease)'
			)
		)
		and ${errorType} !~ '(abort|worker|scanner|coordinator|claim|lease)'`;
	return `
		lower(coalesce(${tableAlias}."errorMessage", '')) not like '%abort%'
		and (
			(${evidenceChannel} = 'archive_evidence' and ((${integrityFailure}) or (${missingFailure})))
			or (${evidenceChannel} = 'archive_availability' and (${missingFailure}))
		)
	`;
}
