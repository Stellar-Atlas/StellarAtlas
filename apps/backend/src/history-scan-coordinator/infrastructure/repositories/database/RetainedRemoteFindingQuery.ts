/** Root/type rollups concern only the sparse retained-only projection, not queue status. */
export function retainedRemoteCountSql(
	root: string,
	objectType?: string
): string {
	return `coalesce((select sum(retained_summary."retainedObjects")
		from history_archive_retained_remote_summary retained_summary
		where retained_summary."archiveUrlIdentity" = ${root}
		${objectType === undefined ? '' : `and (${objectType} is null or retained_summary."objectType" = ${objectType})`}
	), 0)`;
}

export function retainedRemoteFutureCountSql(
	root: string,
	snapshot: string,
	objectType?: string
): string {
	return `(select count(*) from history_archive_retained_remote_finding retained
		where retained."archiveUrlIdentity" = ${root} and retained."retainedOnly"
		and retained."objectCreatedAt" > ${snapshot}
		${objectType === undefined ? '' : `and (${objectType} is null or retained."objectType" = ${objectType})`}
	)`;
}

export const retainedRemotePageKeysSql = `
	select candidate."createdAt", candidate."remoteId"
	from requested_roots requested_root
	cross join lateral (
		select retained."objectCreatedAt" as "createdAt",
			retained."objectRemoteId" as "remoteId"
		from history_archive_retained_remote_finding retained
		where retained."archiveUrlIdentity" = requested_root."archiveUrlIdentity"
			and retained."retainedOnly"
			and ($3::text is null or retained."objectType" = $3::text)
			and retained."objectCreatedAt" <= $4::timestamptz
			and ($5::timestamptz is null or
				(retained."objectCreatedAt", retained."objectRemoteId") <
				($5::timestamptz, $6::uuid))
		order by retained."objectCreatedAt" desc, retained."objectRemoteId" desc
		limit $7
	) candidate
	order by candidate."createdAt" desc, candidate."remoteId" desc
	limit $7
`;

export const retainedRemoteFindingJsonSql = `
	case when finding."retainedOnly" then jsonb_build_object(
		'observedAt', finding."observedAt",
		'failureChannel', finding."failureChannel",
		'errorType', finding."errorType",
		'errorMessage', finding."errorMessage",
		'httpStatus', finding."httpStatus"
	) else null end as "retainedFinding"
`;
