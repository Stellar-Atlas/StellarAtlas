import type { EntityManager } from 'typeorm';
import type { HistoryArchiveSourceSummaryV1 } from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type SourceSummaryRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly currentLedger?: NumericValue | null;
	readonly currentledger?: NumericValue | null;
	readonly failedObjects?: NumericValue;
	readonly failedobjects?: NumericValue;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly latestDiscoveredCheckpointLedger?: NumericValue | null;
	readonly latestdiscoveredcheckpointledger?: NumericValue | null;
	readonly objectCompleteCheckpoints?: NumericValue;
	readonly objectcompletecheckpoints?: NumericValue;
	readonly observedAt?: Date | string;
	readonly observedat?: Date | string;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly rootActiveObjects?: NumericValue;
	readonly rootactiveobjects?: NumericValue;
	readonly rootPendingObjects?: NumericValue;
	readonly rootpendingobjects?: NumericValue;
	readonly rootTotalObjects?: NumericValue;
	readonly roottotalobjects?: NumericValue;
	readonly rootVerifiedObjects?: NumericValue;
	readonly rootverifiedobjects?: NumericValue;
	readonly source?: string;
	readonly stateStatus?: string;
	readonly statestatus?: string;
	readonly stateUrl?: string;
	readonly stateurl?: string;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly verifiedCheckpoints?: NumericValue;
	readonly verifiedcheckpoints?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
};

export async function getSourceSummariesFromRollup(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveSourceSummaryV1[]> {
	const rows = (await manager.query(sourceSummarySql, [
		archiveUrlIdentity
	])) as readonly SourceSummaryRow[];

	return rows.map(mapSourceSummaryRow);
}

function mapSourceSummaryRow(
	row: SourceSummaryRow
): HistoryArchiveSourceSummaryV1 {
	const counts = mapObjectCounts(row);
	return {
		...counts,
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		currentLedger: nullableNumber(row.currentLedger ?? row.currentledger),
		latestCheckpointLedger: nullableNumber(
			row.latestCheckpointLedger ?? row.latestcheckpointledger
		),
		latestDiscoveredCheckpointLedger: nullableNumber(
			row.latestDiscoveredCheckpointLedger ??
				row.latestdiscoveredcheckpointledger
		),
		objectCompleteCheckpoints: requireNumber(
			row.objectCompleteCheckpoints ?? row.objectcompletecheckpoints,
			'objectCompleteCheckpoints'
		),
		observedAt: formatDateField(row.observedAt ?? row.observedat),
		rootObjectStatus: mapRootObjectStatus(row),
		source: requireStateSource(row.source),
		stateStatus: requireStateStatus(row.stateStatus ?? row.statestatus),
		stateUrl: requireString(row.stateUrl ?? row.stateurl, 'stateUrl'),
		verifiedCheckpoints: requireNumber(
			row.verifiedCheckpoints ?? row.verifiedcheckpoints,
			'verifiedCheckpoints'
		)
	};
}

function mapObjectCounts(
	row: SourceSummaryRow
): Pick<
	HistoryArchiveSourceSummaryV1,
	| 'activeObjects'
	| 'failedObjects'
	| 'pendingObjects'
	| 'totalObjects'
	| 'verifiedObjects'
> {
	const counts = {
		activeObjects: requireNumber(
			row.activeObjects ?? row.activeobjects,
			'activeObjects'
		),
		failedObjects: requireNumber(
			row.failedObjects ?? row.failedobjects,
			'failedObjects'
		),
		pendingObjects: requireNumber(
			row.pendingObjects ?? row.pendingobjects,
			'pendingObjects'
		),
		totalObjects: requireNumber(
			row.totalObjects ?? row.totalobjects,
			'totalObjects'
		),
		verifiedObjects: requireNumber(
			row.verifiedObjects ?? row.verifiedobjects,
			'verifiedObjects'
		)
	};
	if (
		counts.totalObjects !==
		counts.pendingObjects +
			counts.activeObjects +
			counts.verifiedObjects +
			counts.failedObjects
	) {
		throw new Error(
			'Archive object source summary row has inconsistent counts'
		);
	}
	return counts;
}

function mapRootObjectStatus(
	row: SourceSummaryRow
): HistoryArchiveSourceSummaryV1['rootObjectStatus'] {
	const total = requireNumber(
		row.rootTotalObjects ?? row.roottotalobjects,
		'rootTotalObjects'
	);
	const pending = requireNumber(
		row.rootPendingObjects ?? row.rootpendingobjects,
		'rootPendingObjects'
	);
	const active = requireNumber(
		row.rootActiveObjects ?? row.rootactiveobjects,
		'rootActiveObjects'
	);
	const verified = requireNumber(
		row.rootVerifiedObjects ?? row.rootverifiedobjects,
		'rootVerifiedObjects'
	);
	const failed = total - pending - active - verified;
	if (total === 0) return null;
	if (total !== 1 || failed < 0) {
		throw new Error('Archive source does not have exactly one root object');
	}
	if (pending === 1) return 'pending';
	if (active === 1) return 'scanning';
	if (verified === 1) return 'verified';
	if (failed === 1) return 'failed';
	throw new Error('Archive root object summary has inconsistent counts');
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive object source summary row is missing ${field}`);
}

function nullableNumber(value: NumericValue | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, 'nullableNumber');
}

function formatDateField(value: Date | string | undefined): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return new Date(value).toISOString();
	throw new Error('Archive object source summary row is missing observedAt');
}

function requireStateSource(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['source'] {
	if (
		value === 'backfill' ||
		value === 'history-scanner' ||
		value === 'network-scan'
	) {
		return value;
	}
	throw new Error('Archive object source summary row has invalid source');
}

function requireStateStatus(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['stateStatus'] {
	if (value === 'available' || value === 'invalid' || value === 'unreachable') {
		return value;
	}
	throw new Error('Archive object source summary row has invalid state status');
}

const archiveFilterSql =
	'($1::text is null or "archiveUrlIdentity" = $1::text)';

export const sourceSummarySql = `
	with object_counts as (
		select
			"archiveUrlIdentity",
			sum("totalObjects") as "totalObjects",
			sum("pendingObjects") as "pendingObjects",
			sum("scanningObjects") as "activeObjects",
			sum("verifiedObjects") as "verifiedObjects",
			sum(
				"totalObjects" - "pendingObjects" - "scanningObjects"
					- "verifiedObjects"
			) as "failedObjects",
			coalesce(sum("totalObjects") filter (
				where "objectType" = 'history-archive-state'
			), 0) as "rootTotalObjects",
			coalesce(sum("pendingObjects") filter (
				where "objectType" = 'history-archive-state'
			), 0) as "rootPendingObjects",
			coalesce(sum("scanningObjects") filter (
				where "objectType" = 'history-archive-state'
			), 0) as "rootActiveObjects",
			coalesce(sum("verifiedObjects") filter (
				where "objectType" = 'history-archive-state'
			), 0) as "rootVerifiedObjects"
		from history_archive_object_type_summary
		where ${archiveFilterSql}
		group by "archiveUrlIdentity"
	), checkpoint_bounds as (
		select
			"archiveUrlIdentity",
			"latestCheckpointLedger" as "latestDiscoveredCheckpointLedger",
			"objectCompleteCheckpointProofs" as "objectCompleteCheckpoints",
			"verifiedCheckpointProofs" as "verifiedCheckpoints"
		from history_archive_checkpoint_proof_rollup
		where ${archiveFilterSql}
	)
	select
		state."archiveUrl",
		state."archiveUrlIdentity",
		state."stateUrl",
		state.status as "stateStatus",
		state."observedAt",
		state.source,
		state."currentLedger",
		case
			when state."currentLedger" is null then null
			else (
				floor((greatest(state."currentLedger", 63) + 1)::numeric / 64)::integer
					* 64
			) - 1
		end as "latestCheckpointLedger",
		checkpoint_bounds."latestDiscoveredCheckpointLedger",
		coalesce(checkpoint_bounds."objectCompleteCheckpoints", 0)
			as "objectCompleteCheckpoints",
		coalesce(checkpoint_bounds."verifiedCheckpoints", 0)
			as "verifiedCheckpoints",
		coalesce(object_counts."rootTotalObjects", 0) as "rootTotalObjects",
		coalesce(object_counts."rootPendingObjects", 0) as "rootPendingObjects",
		coalesce(object_counts."rootActiveObjects", 0) as "rootActiveObjects",
		coalesce(object_counts."rootVerifiedObjects", 0) as "rootVerifiedObjects",
		coalesce(object_counts."totalObjects", 0) as "totalObjects",
		coalesce(object_counts."pendingObjects", 0) as "pendingObjects",
		coalesce(object_counts."activeObjects", 0) as "activeObjects",
		coalesce(object_counts."verifiedObjects", 0) as "verifiedObjects",
		coalesce(object_counts."failedObjects", 0) as "failedObjects"
	from history_archive_state_snapshot state
	left join object_counts
		on object_counts."archiveUrlIdentity" = state."archiveUrlIdentity"
	left join checkpoint_bounds
		on checkpoint_bounds."archiveUrlIdentity" = state."archiveUrlIdentity"
	where ($1::text is null or state."archiveUrlIdentity" = $1::text)
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
`;
