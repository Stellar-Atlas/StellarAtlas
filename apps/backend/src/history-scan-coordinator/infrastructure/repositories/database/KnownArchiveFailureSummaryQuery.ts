import type { DataSource } from 'typeorm';
import {
	KnownArchiveFailureSummaryV1Schema,
	type KnownArchiveFailureSummaryV1
} from 'shared';
import Ajv from 'ajv';
import validator from 'validator';
import { sanitizePublicInfrastructureText } from '../../mappers/PublicScanErrorMapper.js';
import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';

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
				? row.summary
				: null;
		return parseKnownArchiveFailureSummary(candidate);
	});
}

export function parseKnownArchiveFailureSummary(
	value: unknown
): KnownArchiveFailureSummaryV1 {
	const candidate = sanitizeSummary(value);
	if (!validate(candidate)) {
		throw new Error('Invalid archive reason summary');
	}
	const summary = candidate;
	const displayed = summary.groups.reduce((sum, group) => sum + group.count, 0);
	if (
		displayed + (summary.remainingFailureCount ?? 0) !==
		summary.remoteFailureCount
	) {
		throw new Error('Archive reason summary rollup is inconsistent');
	}
	if (
		summary.attributionVersion === 1 &&
		(!Number.isSafeInteger(summary.archiveFaultCount) ||
			!Number.isSafeInteger(summary.inconclusiveFailureCount) ||
			(summary.archiveFaultCount ?? 0) +
				(summary.inconclusiveFailureCount ?? 0) !==
				summary.remoteFailureCount ||
			summary.groups.some((group) => group.attribution === undefined) ||
			summary.groups
				.filter((group) => group.attribution === 'archive_fault')
				.reduce((sum, group) => sum + group.count, 0) >
				(summary.archiveFaultCount ?? 0) ||
			summary.groups
				.filter((group) => group.attribution === 'inconclusive')
				.reduce((sum, group) => sum + group.count, 0) >
				(summary.inconclusiveFailureCount ?? 0))
	)
		throw new Error('Archive reason attribution is inconsistent');
	return summary;
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
	with raw_unresolved as not materialized (
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus", "checkpointLedger"
		from history_archive_object_queue
		where "archiveUrlIdentity" = $1::text and status = 'failed'
			and "failureChannel" in ('archive_evidence', 'archive_availability')
		union all
		select retained."objectType", retained."failureChannel", retained."errorType", retained."errorMessage", retained."httpStatus", object."checkpointLedger"
		from history_archive_retained_remote_finding retained
		left join lateral (select "checkpointLedger" from history_archive_object_queue metadata
			where metadata."remoteId" = retained."objectRemoteId"
				and metadata."archiveUrlIdentity" = retained."archiveUrlIdentity" limit 1) object on true
		where retained."archiveUrlIdentity" = $1::text and retained."retainedOnly"
	), unresolved as materialized (
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus",
			${historyArchiveInconclusiveTransportFailureSql('raw')} as inconclusive,
			case when "objectType" in ('checkpoint-state','ledger','transactions','results','scp')
				and "checkpointLedger" >= 63 and "checkpointLedger" % 64 = 63
				then "checkpointLedger" else null end as "checkpointLedger"
		from raw_unresolved raw
	), totals as materialized (
		select count(*) filter (where not inconclusive) as "archiveFaultCount",
			count(*) filter (where inconclusive) as "inconclusiveFailureCount",
			count(distinct "checkpointLedger") filter (where not inconclusive) as "knownAffectedCheckpointCount",
			count(distinct "checkpointLedger") filter (where inconclusive) as "inconclusiveAffectedCheckpointCount",
			count(*) filter (where not inconclusive and "checkpointLedger" is null) as "unknownCheckpointFailureCount"
		from unresolved
	), grouped as materialized (
		select "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus", count(*) as count,
			case when inconclusive then 'inconclusive' else 'archive_fault' end as attribution,
			count(distinct "checkpointLedger") filter (where not inconclusive) as "knownAffectedCheckpointCount",
			count(distinct "checkpointLedger") filter (where inconclusive) as "inconclusiveAffectedCheckpointCount",
			count(*) filter (where not inconclusive and "checkpointLedger" is null) as "unknownCheckpointFailureCount"
		from unresolved
		group by "objectType", "failureChannel", "errorType", "errorMessage", "httpStatus", inconclusive
	), grouped_totals as (
		select count(*) as "totalGroups", coalesce(sum(count), 0) as "totalFailures"
		from grouped
	), selected as materialized (
		select * from grouped
		order by attribution, count desc, "objectType", "failureChannel", "errorType" nulls first,
			"httpStatus" nulls first, "errorMessage" nulls first
		limit 20
	), counts as (
		select coalesce((select "remoteFailureObjects" from history_archive_evidence_root_summary where "archiveUrlIdentity" = $1::text), 0)
			+ coalesce((select sum("retainedObjects") from history_archive_retained_remote_summary where "archiveUrlIdentity" = $1::text), 0) as remote,
			coalesce((select "workerIssueObjects" from history_archive_evidence_root_summary where "archiveUrlIdentity" = $1::text), 0) as worker
	)
	select jsonb_build_object(
		'status', 'current', 'computedAt', now(), 'limit', 20,
		'attributionVersion', 1,
		'archiveFaultCount', totals."archiveFaultCount",
		'inconclusiveFailureCount', totals."inconclusiveFailureCount",
		'groups', coalesce((select jsonb_agg(to_jsonb(selected) order by attribution, count desc,
			"objectType", "failureChannel", "errorType" nulls first, "httpStatus" nulls first,
			"errorMessage" nulls first) from selected), '[]'::jsonb),
		'totalGroups', grouped_totals."totalGroups",
		'remainingGroupCount', grouped_totals."totalGroups" - (select count(*) from selected),
		'remainingFailureCount', grouped_totals."totalFailures" - coalesce((select sum(count) from selected), 0),
		'remoteFailureCount', counts.remote, 'workerIssueCount', counts.worker
		,'knownAffectedCheckpointCount', totals."knownAffectedCheckpointCount"
		,'inconclusiveAffectedCheckpointCount', totals."inconclusiveAffectedCheckpointCount"
		,'unknownCheckpointFailureCount', totals."unknownCheckpointFailureCount"
	) as summary from counts cross join totals cross join grouped_totals
`;
