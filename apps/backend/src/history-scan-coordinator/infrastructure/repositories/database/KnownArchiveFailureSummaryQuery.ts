import type { DataSource } from 'typeorm';
import {
	KnownArchiveFailureSummaryV1Schema,
	type KnownArchiveFailureSummaryV1
} from 'shared';
import Ajv from 'ajv';
import validator from 'validator';
import { sanitizePublicInfrastructureText } from '../../mappers/PublicScanErrorMapper.js';

const ajv = new Ajv();
ajv.addFormat('date-time', { type: 'string', validate: validator.isRFC3339 });
const validate = ajv.compile(KnownArchiveFailureSummaryV1Schema);

export async function queryKnownArchiveFailureSummary(
	dataSource: DataSource,
	archiveUrlIdentity: string
): Promise<KnownArchiveFailureSummaryV1> {
	return dataSource.transaction('REPEATABLE READ', async (manager) => {
		await manager.query('set transaction read only');
		await manager.query("set local statement_timeout = '3s'");
		await manager.query("set local lock_timeout = '250ms'");
		const rows: unknown = await manager.query(knownArchiveFailureSummarySql, [
			archiveUrlIdentity
		]);
		if (!Array.isArray(rows))
			throw new Error('Invalid archive reason summary rows');
		const row: unknown = rows[0];
		const candidate =
			typeof row === 'object' && row !== null && 'summary' in row
				? sanitizeSummary(row.summary)
				: null;
		if (!validate(candidate)) {
			throw new Error('Invalid archive reason summary');
		}
		const summary = candidate;
		const displayed = summary.groups.reduce(
			(sum, group) => sum + group.count,
			0
		);
		if (
			displayed + (summary.remainingFailureCount ?? 0) !==
			summary.remoteFailureCount
		) {
			throw new Error('Archive reason summary rollup is inconsistent');
		}
		return summary;
	});
}

function sanitizeSummary(value: unknown): unknown {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('groups' in value) ||
		!Array.isArray(value.groups)
	)
		return value;
	return {
		...value,
		groups: value.groups.map((group: unknown) => {
			if (typeof group !== 'object' || group === null) return group;
			return {
				...group,
				...('errorType' in group && typeof group.errorType === 'string'
					? { errorType: sanitizePublicInfrastructureText(group.errorType) }
					: {}),
				...('errorMessage' in group && typeof group.errorMessage === 'string'
					? {
							errorMessage: sanitizePublicInfrastructureText(group.errorMessage)
						}
					: {})
			};
		})
	};
}

export const knownArchiveFailureSummarySql = `
	with unresolved as materialized (
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus"
		from history_archive_object_queue
		where "archiveUrlIdentity" = $1::text and status = 'failed'
			and "failureChannel" in ('archive_evidence', 'archive_availability')
		union all
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus"
		from history_archive_retained_remote_finding
		where "archiveUrlIdentity" = $1::text and "retainedOnly"
	), grouped as materialized (
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus", count(*) as count
		from unresolved
		group by "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus"
	), selected as materialized (
		select * from grouped
		order by count desc, "objectType", "failureChannel", "errorType" nulls first,
			"httpStatus" nulls first, "errorMessage" nulls first
		limit 20
	), counts as (
		select coalesce((select "remoteFailureObjects" from history_archive_evidence_root_summary where "archiveUrlIdentity" = $1::text), 0)
			+ coalesce((select sum("retainedObjects") from history_archive_retained_remote_summary where "archiveUrlIdentity" = $1::text), 0) as remote,
			coalesce((select "workerIssueObjects" from history_archive_evidence_root_summary where "archiveUrlIdentity" = $1::text), 0) as worker
	)
	select jsonb_build_object(
		'status', 'current', 'computedAt', now(), 'limit', 20,
		'groups', coalesce((select jsonb_agg(to_jsonb(selected) order by count desc,
			"objectType", "failureChannel", "errorType" nulls first, "httpStatus" nulls first,
			"errorMessage" nulls first) from selected), '[]'::jsonb),
		'totalGroups', (select count(*) from grouped),
		'remainingGroupCount', (select count(*) from grouped) - (select count(*) from selected),
		'remainingFailureCount', coalesce((select sum(count) from grouped), 0) - coalesce((select sum(count) from selected), 0),
		'remoteFailureCount', counts.remote, 'workerIssueCount', counts.worker
	) as summary from counts
`;
