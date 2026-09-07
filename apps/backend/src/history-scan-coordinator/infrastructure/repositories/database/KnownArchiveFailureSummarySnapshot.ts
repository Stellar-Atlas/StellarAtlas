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

export const archiveFailureSummaryFreshnessMs = 300_000;
const schemaPresence = new WeakMap<
	object,
	{ ready: boolean; expiresAt: number }
>();

async function snapshotSchemaReady(
	manager: EntityManager,
	now: number
): Promise<boolean> {
	const cached = schemaPresence.get(manager.connection);
	if (cached !== undefined && cached.expiresAt > now) return cached.ready;
	const rows = await manager.query<{ ready: boolean }[]>(
		"select to_regclass('history_archive_failure_summary_snapshot') is not null as ready"
	);
	const ready = rows[0]?.ready === true;
	schemaPresence.set(manager.connection, {
		ready,
		expiresAt: now + (ready ? 300_000 : 1_000)
	});
	return ready;
}

export async function readKnownArchiveFailureSummarySnapshots(
	manager: EntityManager,
	roots: readonly string[],
	now = new Date()
): Promise<ReadonlyMap<string, KnownArchiveFailureSummaryV1>> {
	if (roots.length === 0) return new Map();
	if (!(await snapshotSchemaReady(manager, now.getTime()))) return new Map();
	const rows = await manager.query<
		{
			archiveUrlIdentity: string;
			summary: unknown;
			lastErrorCode: string | null;
		}[]
	>(
		`
		select "archiveUrlIdentity", summary, "lastErrorCode"
		from history_archive_failure_summary_snapshot where "archiveUrlIdentity"=any($1::text[])
	`,
		[[...new Set(roots)]]
	);
	const values = new Map<string, KnownArchiveFailureSummaryV1>();
	for (const row of rows) {
		try {
			const summary = parseKnownArchiveFailureSummary(row.summary);
			if (summary.attributionVersion !== 1) {
				values.set(row.archiveUrlIdentity, unavailableArchiveFailureSummary);
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
