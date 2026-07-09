import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveCheckpointCoverageV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveSourceSummaryV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';
import { getCheckpointCoverage } from './HistoryArchiveObjectCheckpointCoverageQuery.js';

type SourceRow = {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly currentLedger?: NumericValue | null;
	readonly currentledger?: NumericValue | null;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly latestDiscoveredCheckpointLedger?: NumericValue | null;
	readonly latestdiscoveredcheckpointledger?: NumericValue | null;
	readonly objectCompleteCheckpoints?: NumericValue;
	readonly objectcompletecheckpoints?: NumericValue;
	readonly observedAt?: Date | string;
	readonly observedat?: Date | string;
	readonly rootObjectStatus?: string | null;
	readonly rootobjectstatus?: string | null;
	readonly source?: string;
	readonly stateStatus?: string;
	readonly statestatus?: string;
	readonly stateUrl?: string;
	readonly stateurl?: string;
	readonly totalProofRows?: NumericValue;
	readonly totalproofrows?: NumericValue;
	readonly pendingProofRows?: NumericValue;
	readonly pendingproofrows?: NumericValue;
	readonly failedProofRows?: NumericValue;
	readonly failedproofrows?: NumericValue;
	readonly verifiedCheckpoints?: NumericValue;
	readonly verifiedcheckpoints?: NumericValue;
};

type ActiveRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
};

export async function getHistoryArchiveObjectStatusSummary(
	manager: EntityManager,
	generatedAt = new Date()
): Promise<HistoryArchiveObjectSummaryV1> {
	const [checkpoints, sources, activeObjects] = await Promise.all([
		getCheckpointCoverage(manager, null),
		getStatusSourceSummaries(manager),
		getActiveObjectCount(manager)
	]);
	const totals = proofTotals(checkpoints, activeObjects);

	return {
		...totals,
		archiveUrl: null,
		archiveUrlIdentity: null,
		buckets: {
			activeBucketObjects: 0,
			failedBucketObjects: 0,
			pendingBucketObjects: 0,
			totalBucketObjects: 0,
			uniqueBucketHashes: 0,
			verifiedBucketObjects: 0
		},
		checkpoints,
		generatedAt: generatedAt.toISOString(),
		hostThrottles: [],
		objectTypes: [],
		scope: 'global',
		sources
	};
}

async function getStatusSourceSummaries(
	manager: EntityManager
): Promise<readonly HistoryArchiveSourceSummaryV1[]> {
	const rows = (await manager.query(sourceStatusSummarySql)) as readonly SourceRow[];
	return rows.map(mapSourceRow);
}

async function getActiveObjectCount(manager: EntityManager): Promise<number> {
	const [row] = (await manager.query(activeObjectCountSql)) as readonly ActiveRow[];
	return requireNumber(row?.activeObjects ?? row?.activeobjects, 'activeObjects');
}

function proofTotals(
	checkpoints: HistoryArchiveCheckpointCoverageV1,
	activeObjects: number
): Pick<
	HistoryArchiveObjectSummaryV1,
	| 'activeObjects'
	| 'failedObjects'
	| 'pendingObjects'
	| 'totalObjects'
	| 'verifiedObjects'
> {
	const pendingObjects =
		checkpoints.categoryConsistencyPendingCheckpoints +
		checkpoints.categoryConsistencyNotEvaluatedCheckpoints;

	return {
		activeObjects,
		failedObjects: checkpoints.categoryConsistencyFailedCheckpoints,
		pendingObjects,
		totalObjects: checkpoints.totalArchiveCheckpoints,
		verifiedObjects: checkpoints.categoryConsistentArchiveCheckpoints
	};
}

function mapSourceRow(row: SourceRow): HistoryArchiveSourceSummaryV1 {
	const totalObjects = numberField(row, 'totalProofRows');
	const failedObjects = numberField(row, 'failedProofRows');
	const pendingObjects = numberField(row, 'pendingProofRows');
	const verifiedCheckpoints = numberField(row, 'verifiedCheckpoints');

	return {
		activeObjects: 0,
		archiveUrl: stringField(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: stringField(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		currentLedger: nullableNumber(row.currentLedger ?? row.currentledger),
		failedObjects,
		latestCheckpointLedger: nullableNumber(
			row.latestCheckpointLedger ?? row.latestcheckpointledger
		),
		latestDiscoveredCheckpointLedger: nullableNumber(
			row.latestDiscoveredCheckpointLedger ??
				row.latestdiscoveredcheckpointledger
		),
		objectCompleteCheckpoints: numberField(row, 'objectCompleteCheckpoints'),
		observedAt: dateField(row.observedAt ?? row.observedat),
		pendingObjects,
		rootObjectStatus: rootStatus(row.rootObjectStatus ?? row.rootobjectstatus),
		source: sourceField(row.source),
		stateStatus: stateStatus(row.stateStatus ?? row.statestatus),
		stateUrl: stringField(row.stateUrl ?? row.stateurl, 'stateUrl'),
		totalObjects,
		verifiedCheckpoints,
		verifiedObjects: verifiedCheckpoints
	};
}

function numberField(row: SourceRow, field: keyof SourceRow): number {
	const value = row[field] ?? row[lowercase(field)];
	if (value === null || value instanceof Date) {
		throw new Error(`Archive status source row is missing ${field}`);
	}
	return requireNumber(value, field);
}

function nullableNumber(value: NumericValue | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, 'nullableNumber');
}

function stringField(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive status source row is missing ${field}`);
}

function dateField(value: Date | string | undefined): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return new Date(value).toISOString();
	throw new Error('Archive status source row is missing observedAt');
}

function rootStatus(
	value: string | null | undefined
): HistoryArchiveSourceSummaryV1['rootObjectStatus'] {
	if (value === null || value === undefined) return null;
	if (
		value === 'pending' ||
		value === 'scanning' ||
		value === 'verified' ||
		value === 'failed'
	) {
		return value;
	}
	throw new Error('Archive status source row has invalid root status');
}

function sourceField(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['source'] {
	if (
		value === 'backfill' ||
		value === 'history-scanner' ||
		value === 'network-scan'
	) {
		return value;
	}
	throw new Error('Archive status source row has invalid source');
}

function stateStatus(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['stateStatus'] {
	if (value === 'available' || value === 'invalid' || value === 'unreachable') {
		return value;
	}
	throw new Error('Archive status source row has invalid state status');
}

function lowercase(field: keyof SourceRow): keyof SourceRow {
	return field.toLowerCase() as keyof SourceRow;
}

const activeObjectCountSql = `
	select count(*)::int as "activeObjects"
	from history_archive_object_queue
	where status = 'scanning'
`;

const sourceStatusSummarySql = `
	with root_object as (
		select distinct on ("archiveUrlIdentity")
			"archiveUrlIdentity",
			status as "rootObjectStatus"
		from history_archive_object_queue
		where "objectType" = 'history-archive-state'
		order by "archiveUrlIdentity", "updatedAt" desc
	),
	proof_counts as (
		select
			"archiveUrlIdentity",
			count(*) as "totalProofRows",
			count(*) filter (where status = 'pending' or status = 'not-evaluable')
				as "pendingProofRows",
			count(*) filter (where status = 'mismatch') as "failedProofRows",
			count(*) filter (where status = 'verified') as "verifiedCheckpoints",
			count(*) filter (where "requiredObjectsComplete")
				as "objectCompleteCheckpoints",
			max("checkpointLedger") as "latestDiscoveredCheckpointLedger"
		from history_archive_checkpoint_proof
		group by "archiveUrlIdentity"
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
		proof_counts."latestDiscoveredCheckpointLedger",
		coalesce(proof_counts."objectCompleteCheckpoints", 0)
			as "objectCompleteCheckpoints",
		coalesce(proof_counts."verifiedCheckpoints", 0)
			as "verifiedCheckpoints",
		root_object."rootObjectStatus",
		coalesce(proof_counts."totalProofRows", 0) as "totalProofRows",
		coalesce(proof_counts."pendingProofRows", 0) as "pendingProofRows",
		coalesce(proof_counts."failedProofRows", 0) as "failedProofRows"
	from history_archive_state_snapshot state
	left join root_object
		on root_object."archiveUrlIdentity" = state."archiveUrlIdentity"
	left join proof_counts
		on proof_counts."archiveUrlIdentity" = state."archiveUrlIdentity"
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
`;
