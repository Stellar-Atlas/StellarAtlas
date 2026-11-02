import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveStatusSourceV1,
	KnownArchiveFailureSummaryV1
} from 'shared';
import { parseKnownArchiveFailureSummary } from './KnownArchiveFailureSummaryQuery.js';
import {
	emptyArchiveFailureSummary,
	unavailableArchiveFailureSummary
} from './KnownArchiveFailureSummaryValue.js';
import {
	archiveFailureSummarySchema,
	archiveFailureSummarySourceStateSql,
	archiveFailureSummaryDigestSql,
	isArchiveFailureSummaryRootRevision,
	queryFingerprint
} from './KnownArchiveFailureSummaryVersion.js';

export const archiveFailureSummaryFreshnessMs = 300_000;

export const versionedArchiveFailureSummarySnapshotReadSql = `
	with roots as (select distinct unnest($1::text[]) as "archiveUrlIdentity")
	select roots."archiveUrlIdentity", snapshot.summary, snapshot."lastErrorCode",
		snapshot."sourceRootRevision"::text as "sourceRootRevision",
		snapshot."sourceRetainedRevision", snapshot."sourceQueryHash", snapshot."sourceSummaryHash",
		${archiveFailureSummaryDigestSql('snapshot')} as "actualSummaryHash", source.*
	from roots
	cross join lateral (${archiveFailureSummarySourceStateSql('roots')}) source
	left join history_archive_failure_summary_snapshot snapshot using ("archiveUrlIdentity")
`;

// Do not reference rollout columns until their catalog presence is confirmed.
export const legacyArchiveFailureSummarySnapshotReadSql = `
	select "archiveUrlIdentity", summary, "lastErrorCode"
	from history_archive_failure_summary_snapshot where "archiveUrlIdentity"=any($1::text[])
`;

export async function readKnownArchiveFailureSummarySnapshots(
	manager: EntityManager,
	roots: readonly string[],
	now = new Date()
): Promise<ReadonlyMap<string, KnownArchiveFailureSummaryV1>> {
	if (roots.length === 0) return new Map();
	const schema = await archiveFailureSummarySchema(manager, now.getTime());
	if (!schema.snapshotReady) return new Map();
	const rows = await manager.query<
		{
			archiveUrlIdentity: string;
			summary: unknown;
			lastErrorCode: string | null;
			sourceRootRevision?: string | null;
			sourceRetainedRevision?: string | null;
			sourceQueryHash?: string | null;
			sourceSummaryHash?: string | null;
			actualSummaryHash?: string | null;
			rootRevision?: string;
			retainedRevision?: string;
			remoteFailureCount?: string;
			workerIssueCount?: string;
		}[]
	>(
		schema.versionedReady
			? versionedArchiveFailureSummarySnapshotReadSql
			: legacyArchiveFailureSummarySnapshotReadSql,
		[[...new Set(roots)]]
	);
	const values = new Map<string, KnownArchiveFailureSummaryV1>();
	for (const row of rows) {
		try {
			const remoteCount = schema.versionedReady
				? compactCount(row.remoteFailureCount)
				: null;
			const workerCount = schema.versionedReady
				? compactCount(row.workerIssueCount)
				: null;
			if (remoteCount === 0 && workerCount !== null) {
				values.set(
					row.archiveUrlIdentity,
					emptyArchiveFailureSummary(now, workerCount)
				);
				continue;
			}
			const summary = parseKnownArchiveFailureSummary(row.summary);
			if (summary.attributionVersion !== 1) {
				values.set(row.archiveUrlIdentity, unavailableArchiveFailureSummary);
				continue;
			}
			if (schema.versionedReady) {
				const current =
					summary.computedAt !== null &&
					row.lastErrorCode === null &&
					row.sourceRootRevision === row.rootRevision &&
					isArchiveFailureSummaryRootRevision(row.rootRevision) &&
					row.sourceRetainedRevision === row.retainedRevision &&
					typeof row.retainedRevision === 'string' &&
					row.sourceQueryHash === queryFingerprint &&
					typeof row.sourceSummaryHash === 'string' &&
					row.sourceSummaryHash === row.actualSummaryHash &&
					summary.remoteFailureCount === remoteCount &&
					summary.workerIssueCount === workerCount;
				values.set(row.archiveUrlIdentity, {
					...summary,
					status: current ? 'current' : 'stale'
				});
				continue;
			}
			const old =
				summary.computedAt === null ||
				now.getTime() - Date.parse(summary.computedAt) >=
					archiveFailureSummaryFreshnessMs;
			values.set(
				row.archiveUrlIdentity,
				row.lastErrorCode !== null || old
					? { ...summary, status: 'stale' }
					: summary
			);
		} catch {
			values.set(row.archiveUrlIdentity, unavailableArchiveFailureSummary);
		}
	}
	return values;
}

function compactCount(value: string | undefined): number {
	if (typeof value !== 'string' || !/^\d+$/.test(value))
		throw new Error('Invalid archive failure summary metadata count');
	const count = Number(value);
	if (!Number.isSafeInteger(count))
		throw new Error('Archive failure summary metadata count is too large');
	return count;
}

/** Exactly one small snapshot read for all inventory roots; never regroup raw findings here. */
export async function attachArchiveFailureSummaries(
	manager: EntityManager,
	sources: readonly HistoryArchiveStatusSourceV1[],
	now = new Date()
): Promise<readonly HistoryArchiveStatusSourceV1[]> {
	const nonzero = sources.filter(
		(source) => source.archiveEvidenceFailures > 0
	);
	const snapshots = await readKnownArchiveFailureSummarySnapshots(
		manager,
		nonzero.map((source) => source.archiveUrlIdentity),
		now
	);
	return sources.map((source) => {
		let summary =
			source.archiveEvidenceFailures === 0
				? emptyArchiveFailureSummary(now, source.scannerIssueFailures)
				: (snapshots.get(source.archiveUrlIdentity) ??
					unavailableArchiveFailureSummary);
		if (
			summary.computedAt !== null &&
			summary.remoteFailureCount !== source.archiveEvidenceFailures
		)
			summary = { ...summary, status: 'stale' };
		return { ...source, failureSummary: summary };
	});
}
