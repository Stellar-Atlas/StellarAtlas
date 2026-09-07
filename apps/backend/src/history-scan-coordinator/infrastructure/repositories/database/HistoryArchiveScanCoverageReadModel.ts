import type { EntityManager } from 'typeorm';
import type { HistoryArchiveStatusSourceV1 } from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type Coverage = NonNullable<HistoryArchiveStatusSourceV1['scanCoverage']>;
interface CoverageRow {
	readonly archiveUrlIdentity: string;
	readonly checkedCheckpointPositions: NumericValue;
	readonly listingCoveredCheckpointPositions: NumericValue;
	readonly scannedCheckpointPositions: NumericValue;
	readonly complete: boolean;
	readonly listingGapRanges?: HistoryArchiveStatusSourceV1['listingGapRanges'];
	readonly updatedAt: Date | string | null;
}
const schemaReady = new WeakMap<object, Promise<boolean>>();

async function hasProjection(manager: EntityManager): Promise<boolean> {
	const existing = schemaReady.get(manager.connection);
	if (existing) return existing;
	const pending = manager
		.query(
			`
  select to_regclass('history_archive_checkpoint_scan_summary') is not null
   and to_regclass('history_archive_checkpoint_scan_seed_state') is not null as ready
 `
		)
		.then(
			(rows: readonly { readonly ready: boolean }[]) => rows[0]?.ready === true
		);
	schemaReady.set(manager.connection, pending);
	try {
		const ready = await pending;
		if (!ready) schemaReady.delete(manager.connection);
		return ready;
	} catch (error) {
		schemaReady.delete(manager.connection);
		throw error;
	}
}

export const archiveScanCoverageSummarySql = `
 with readiness as (
  select count(*) = 4 and bool_and(complete) as complete
  from history_archive_checkpoint_scan_seed_state
  where source in ('queue','events','attestations','listings')
 )
 select requested.root as "archiveUrlIdentity",
  coalesce(summary."checkedCheckpointPositions",0) as "checkedCheckpointPositions",
  coalesce(summary."listingCoveredCheckpointPositions",0) as "listingCoveredCheckpointPositions",
  coalesce(summary."scannedCheckpointPositions",0) as "scannedCheckpointPositions",
  readiness.complete, summary."updatedAt", gaps."listingGapRanges"
 from unnest($1::text[]) requested(root)
 cross join readiness
 left join history_archive_checkpoint_scan_summary summary
  on summary."archiveUrlIdentity" = requested.root
 left join lateral (
 select coalesce(jsonb_agg(to_jsonb(sample) order by sample."firstCheckpointLedger"), '[]'::jsonb) as "listingGapRanges"
 from (
 select gap."firstCheckpointLedger", gap."lastCheckpointLedger",
 ((gap."lastCheckpointLedger"-gap."firstCheckpointLedger")/64+1)::integer as "checkpointCount",
 gap."observedAt", gap."listingEvidence"->>'kind' as kind
 from history_archive_listing_gap gap
 where gap."archiveUrlIdentity" = requested.root and gap."resolvedAt" is null
 order by gap."firstCheckpointLedger", gap."lastCheckpointLedger" limit 5
 ) sample
 ) gaps on true
`;

export async function attachArchiveScanCoverage(
	manager: EntityManager,
	sources: readonly HistoryArchiveStatusSourceV1[]
): Promise<readonly HistoryArchiveStatusSourceV1[]> {
	if (sources.length === 0 || !(await hasProjection(manager))) return sources;
	const rows = (await manager.query(archiveScanCoverageSummarySql, [
		sources.map((source) => source.archiveUrlIdentity)
	])) as readonly CoverageRow[];
	const coverage = new Map<string, Coverage>(
		rows.map((row) => [
			row.archiveUrlIdentity,
			{
				checkedCheckpointPositions: requireNumber(
					row.checkedCheckpointPositions,
					'checkedCheckpointPositions'
				),
				listingCoveredCheckpointPositions: requireNumber(
					row.listingCoveredCheckpointPositions,
					'listingCoveredCheckpointPositions'
				),
				scannedCheckpointPositions: requireNumber(
					row.scannedCheckpointPositions,
					'scannedCheckpointPositions'
				),
				status: row.complete ? 'complete' : 'reconciling',
				updatedAt:
					row.updatedAt === null ? null : new Date(row.updatedAt).toISOString()
			}
		])
	);
	return sources.map((source) => {
		const scan = coverage.get(source.archiveUrlIdentity);
		return {
			...source,
			listingGapRanges:
				rows.find((row) => row.archiveUrlIdentity === source.archiveUrlIdentity)
					?.listingGapRanges ?? [],
			scanCoverage: scan && {
				...scan,
				status:
					scan.status === 'complete' &&
					scan.scannedCheckpointPositions >=
						source.durableVerifiedCheckpointProofs
						? ('complete' as const)
						: ('reconciling' as const)
			}
		};
	});
}
