import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { knownArchiveFailureSummarySql } from './KnownArchiveFailureSummaryQuery.js';

// Includes the interpolated attribution/classifier SQL, not a hand-maintained version.
export const queryFingerprint = createHash('sha256')
	.update(knownArchiveFailureSummarySql)
	.digest('hex');

export interface ArchiveFailureSummarySchema {
	readonly snapshotReady: boolean;
	readonly versionedReady: boolean;
}

const schemas = new WeakMap<
	object,
	{ value: ArchiveFailureSummarySchema; expiresAt: number }
>();

export const archiveFailureSummarySchemaSql = `
	with required(relation_name, column_name) as (values
		('history_archive_failure_summary_snapshot', 'archiveUrlIdentity'),
		('history_archive_failure_summary_snapshot', 'summary'),
		('history_archive_failure_summary_snapshot', 'computedAt'),
		('history_archive_failure_summary_snapshot', 'lastAttemptAt'),
		('history_archive_failure_summary_snapshot', 'lastErrorCode'),
		('history_archive_failure_summary_snapshot', 'sourceRootRevision'),
		('history_archive_failure_summary_snapshot', 'sourceRetainedRevision'),
		('history_archive_failure_summary_snapshot', 'sourceQueryHash'),
		('history_archive_failure_summary_snapshot', 'sourceSummaryHash'),
		('history_archive_evidence_root_summary', 'archiveUrlIdentity'),
		('history_archive_evidence_root_summary', 'remoteFailureObjects'),
		('history_archive_evidence_root_summary', 'workerIssueObjects'),
		('history_archive_evidence_root_summary', 'failureSummaryRevision'),
		('history_archive_retained_remote_summary', 'archiveUrlIdentity'),
		('history_archive_retained_remote_summary', 'objectType'),
		('history_archive_retained_remote_summary', 'retainedObjects'),
		('history_archive_retained_remote_summary', 'failureSummaryRevision')
	), presence as (
		select required.*, exists (
			select 1 from pg_attribute attribute
			where attribute.attrelid = to_regclass(required.relation_name)
				and attribute.attname = required.column_name
				and attribute.attnum > 0 and not attribute.attisdropped
		) as present
		from required
	)
	select bool_and(present) filter (
		where relation_name = 'history_archive_failure_summary_snapshot'
			and column_name in ('archiveUrlIdentity','summary','computedAt','lastAttemptAt','lastErrorCode')
	) as "snapshotReady", (bool_and(present)
		and to_regprocedure('pg_catalog.sha256(bytea)') is not null) as "versionedReady"
	from presence
`;

export async function archiveFailureSummarySchema(
	manager: EntityManager,
	now = Date.now()
): Promise<ArchiveFailureSummarySchema> {
	const cached = schemas.get(manager.connection);
	if (cached !== undefined && cached.expiresAt > now) return cached.value;
	const rows = await manager.query<ArchiveFailureSummarySchema[]>(
		archiveFailureSummarySchemaSql
	);
	const value = {
		snapshotReady: rows[0]?.snapshotReady === true,
		versionedReady: rows[0]?.versionedReady === true
	};
	schemas.set(manager.connection, {
		value,
		expiresAt: now + (value.versionedReady ? 300_000 : 1_000)
	});
	return value;
}

/** Only compact source-owned metadata. Tokens must never pass through JS Number. */
export function archiveFailureSummarySourceStateSql(rootAlias: string): string {
	validateAlias(rootAlias);
	const root = `${rootAlias}."archiveUrlIdentity"`;
	return `
		select coalesce(evidence."failureSummaryRevision",-1)::text as "rootRevision",
			retained."retainedRevision",
			(coalesce(evidence."remoteFailureObjects",0) + retained."retainedObjects")::text
				as "remoteFailureCount",
			coalesce(evidence."workerIssueObjects",0)::text as "workerIssueCount"
		from (select 1) seed
		left join history_archive_evidence_root_summary evidence
			on evidence."archiveUrlIdentity" = ${root}
		cross join lateral (
			select coalesce(array_agg("objectType" || ':' || "failureSummaryRevision"::text
				order by "objectType")::text,'{}') as "retainedRevision",
				coalesce(sum("retainedObjects"),0) as "retainedObjects"
			from history_archive_retained_remote_summary
			where "archiveUrlIdentity" = ${root}
		) retained
	`;
}

export function isArchiveFailureSummaryRootRevision(value: unknown): value is string {
	return typeof value === 'string' && (value === '-1' || /^\d+$/.test(value));
}

/** Small snapshot provenance guard; not archive evidence or a facts-table digest. */
export function archiveFailureSummaryDigestSql(snapshotAlias: string): string {
	validateAlias(snapshotAlias);
	return `encode(sha256(convert_to(${snapshotAlias}.summary::text,'UTF8')),'hex')`;
}

function validateAlias(alias: string): void {
	if (!/^[a-z][a-z0-9_]*$/.test(alias))
		throw new Error('Invalid archive failure summary source alias');
}
