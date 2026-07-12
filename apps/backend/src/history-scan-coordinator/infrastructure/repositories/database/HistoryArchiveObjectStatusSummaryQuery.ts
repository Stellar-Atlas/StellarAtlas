import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveStatusSourceV1,
	HistoryArchiveStatusSummaryV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';
import { getCheckpointCoverage } from './HistoryArchiveObjectCheckpointCoverageQuery.js';

type SourceRow = {
	readonly activeObjectChecks?: NumericValue;
	readonly activeobjectchecks?: NumericValue;
	readonly archiveEvidenceFailures?: NumericValue;
	readonly archiveevidencefailures?: NumericValue;
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
	readonly mismatchCheckpointProofs?: NumericValue;
	readonly mismatchcheckpointproofs?: NumericValue;
	readonly notEvaluableCheckpointProofs?: NumericValue;
	readonly notevaluablecheckpointproofs?: NumericValue;
	readonly objectCompleteCheckpointProofs?: NumericValue;
	readonly objectcompletecheckpointproofs?: NumericValue;
	readonly observedAt?: Date | string;
	readonly observedat?: Date | string;
	readonly pendingCheckpointProofs?: NumericValue;
	readonly pendingcheckpointproofs?: NumericValue;
	readonly rootObjectStatus?: string | null;
	readonly rootobjectstatus?: string | null;
	readonly rootFailureChannel?: string | null;
	readonly rootfailurechannel?: string | null;
	readonly scannerIssueFailures?: NumericValue;
	readonly scannerissuefailures?: NumericValue;
	readonly source?: string;
	readonly stateStatus?: string;
	readonly statestatus?: string;
	readonly stateUrl?: string;
	readonly stateurl?: string;
	readonly totalCheckpointProofs?: NumericValue;
	readonly totalcheckpointproofs?: NumericValue;
	readonly unclassifiedFailures?: NumericValue;
	readonly unclassifiedfailures?: NumericValue;
	readonly verifiedCheckpointProofs?: NumericValue;
	readonly verifiedcheckpointproofs?: NumericValue;
};

type ActiveRow = {
	readonly activeObjectChecks?: NumericValue;
	readonly activeobjectchecks?: NumericValue;
};

type SourceCountRow = {
	readonly sourceCount?: NumericValue;
	readonly sourcecount?: NumericValue;
};

type FailureCountRow = {
	readonly archiveEvidenceFailures?: NumericValue;
	readonly archiveevidencefailures?: NumericValue;
	readonly scannerIssueFailures?: NumericValue;
	readonly scannerissuefailures?: NumericValue;
	readonly unclassifiedFailures?: NumericValue;
	readonly unclassifiedfailures?: NumericValue;
};

export const historyArchiveStatusSourceLimit = 256;

export async function getHistoryArchiveObjectStatusSummary(
	manager: EntityManager,
	generatedAt = new Date()
): Promise<HistoryArchiveStatusSummaryV1> {
	const [
		checkpointCoverage,
		sources,
		activeObjectChecks,
		sourceCount,
		failureCounts
	] = await Promise.all([
		getCheckpointCoverage(manager, null),
		getStatusSourceSummaries(manager),
		getActiveObjectCount(manager),
		getSourceCount(manager),
		getFailureCounts(manager)
	]);

	return {
		activeObjectChecks,
		archiveEvidenceFailures: failureCounts.archiveEvidenceFailures,
		checkpointCoverage,
		generatedAt: generatedAt.toISOString(),
		sourceCount,
		sourceLimit: historyArchiveStatusSourceLimit,
		scannerIssueFailures: failureCounts.scannerIssueFailures,
		sources,
		sourcesTruncated: sourceCount > sources.length,
		unclassifiedFailures: failureCounts.unclassifiedFailures
	};
}

async function getFailureCounts(
	manager: EntityManager
): Promise<RequiredFailureCounts> {
	const [row] = (await manager.query(
		failureCountSql
	)) as readonly FailureCountRow[];
	return {
		archiveEvidenceFailures: failureCountField(row, 'archiveEvidenceFailures'),
		scannerIssueFailures: failureCountField(row, 'scannerIssueFailures'),
		unclassifiedFailures: failureCountField(row, 'unclassifiedFailures')
	};
}

type RequiredFailureCounts = Pick<
	HistoryArchiveStatusSummaryV1,
	'archiveEvidenceFailures' | 'scannerIssueFailures' | 'unclassifiedFailures'
>;

function failureCountField(
	row: FailureCountRow | undefined,
	field: keyof FailureCountRow
): number {
	return requireNumber(row?.[field] ?? row?.[lowercaseFailure(field)], field);
}

function lowercaseFailure(field: keyof FailureCountRow): keyof FailureCountRow {
	return field.toLowerCase() as keyof FailureCountRow;
}

async function getStatusSourceSummaries(
	manager: EntityManager
): Promise<readonly HistoryArchiveStatusSourceV1[]> {
	const rows = (await manager.query(sourceStatusSummarySql, [
		historyArchiveStatusSourceLimit
	])) as readonly SourceRow[];
	return rows.map(mapSourceRow);
}

async function getSourceCount(manager: EntityManager): Promise<number> {
	const [row] = (await manager.query(
		sourceCountSql
	)) as readonly SourceCountRow[];
	return requireNumber(row?.sourceCount ?? row?.sourcecount, 'sourceCount');
}

async function getActiveObjectCount(manager: EntityManager): Promise<number> {
	const [row] = (await manager.query(
		activeObjectCountSql
	)) as readonly ActiveRow[];
	return requireNumber(
		row?.activeObjectChecks ?? row?.activeobjectchecks,
		'activeObjectChecks'
	);
}

function mapSourceRow(row: SourceRow): HistoryArchiveStatusSourceV1 {
	return {
		activeObjectChecks: numberField(row, 'activeObjectChecks'),
		archiveEvidenceFailures: numberField(row, 'archiveEvidenceFailures'),
		archiveUrl: stringField(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: stringField(
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
		mismatchCheckpointProofs: numberField(row, 'mismatchCheckpointProofs'),
		notEvaluableCheckpointProofs: numberField(
			row,
			'notEvaluableCheckpointProofs'
		),
		objectCompleteCheckpointProofs: numberField(
			row,
			'objectCompleteCheckpointProofs'
		),
		observedAt: dateField(row.observedAt ?? row.observedat),
		pendingCheckpointProofs: numberField(row, 'pendingCheckpointProofs'),
		rootObjectStatus: rootStatus(row.rootObjectStatus ?? row.rootobjectstatus),
		rootFailureChannel: failureChannel(
			row.rootFailureChannel ?? row.rootfailurechannel
		),
		scannerIssueFailures: numberField(row, 'scannerIssueFailures'),
		source: sourceField(row.source),
		stateStatus: stateStatus(row.stateStatus ?? row.statestatus),
		stateUrl: stringField(row.stateUrl ?? row.stateurl, 'stateUrl'),
		totalCheckpointProofs: numberField(row, 'totalCheckpointProofs'),
		unclassifiedFailures: numberField(row, 'unclassifiedFailures'),
		verifiedCheckpointProofs: numberField(row, 'verifiedCheckpointProofs')
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
): HistoryArchiveStatusSourceV1['rootObjectStatus'] {
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

function failureChannel(
	value: string | null | undefined
): HistoryArchiveStatusSourceV1['rootFailureChannel'] {
	if (value === null || value === undefined) return null;
	if (value === 'archive_evidence' || value === 'scanner_issue') return value;
	throw new Error('Archive status source row has invalid failure channel');
}

function sourceField(
	value: string | undefined
): HistoryArchiveStatusSourceV1['source'] {
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
): HistoryArchiveStatusSourceV1['stateStatus'] {
	if (value === 'available' || value === 'invalid' || value === 'unreachable') {
		return value;
	}
	throw new Error('Archive status source row has invalid state status');
}

function lowercase(field: keyof SourceRow): keyof SourceRow {
	return field.toLowerCase() as keyof SourceRow;
}

export const activeObjectCountSql = `
	select count(*)::int as "activeObjectChecks"
	from history_archive_object_queue
	where status = 'scanning'
`;

export const sourceCountSql = `
	select count(distinct "archiveUrl")::int as "sourceCount"
	from history_archive_state_snapshot
`;

export const failureCountSql = `
	select
		count(*) filter (where "failureChannel" = 'archive_evidence')::bigint
			as "archiveEvidenceFailures",
		count(*) filter (where "failureChannel" = 'scanner_issue')::bigint
			as "scannerIssueFailures",
		count(*) filter (where "failureChannel" is null)::bigint
			as "unclassifiedFailures"
	from history_archive_object_queue
	where status = 'failed'
`;

export const sourceStatusSummarySql = `
	with source_aliases as materialized (
		select "archiveUrl", "archiveUrlIdentity"
		from history_archive_state_snapshot
	), current_state as (
		select distinct on ("archiveUrl")
			"archiveUrl",
			"archiveUrlIdentity",
			"stateUrl",
			status,
			"observedAt",
			source,
			"currentLedger"
		from history_archive_state_snapshot
		order by
			"archiveUrl",
			"observedAt" desc,
			("archiveUrlIdentity" = "archiveUrl") desc,
			"archiveUrlIdentity"
	), root_object_by_identity as (
		select distinct on ("archiveUrlIdentity")
			"archiveUrlIdentity",
			status as "rootObjectStatus",
			"failureChannel" as "rootFailureChannel",
			"updatedAt"
		from history_archive_object_queue
		where "objectType" = 'history-archive-state'
		order by "archiveUrlIdentity", "updatedAt" desc
	), root_object as (
		select distinct on (aliases."archiveUrl")
			aliases."archiveUrl",
			root."rootObjectStatus",
			root."rootFailureChannel"
		from source_aliases aliases
		join root_object_by_identity root
			on root."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		order by
			aliases."archiveUrl",
			root."updatedAt" desc,
			(root."archiveUrlIdentity" = aliases."archiveUrl") desc,
			root."archiveUrlIdentity"
	), active_objects_by_identity as (
		select "archiveUrlIdentity", count(*)::int as "activeObjectChecks"
		from history_archive_object_queue
		where status = 'scanning'
		group by "archiveUrlIdentity"
	), active_objects as (
		select
			aliases."archiveUrl",
			sum(active."activeObjectChecks") as "activeObjectChecks"
		from source_aliases aliases
		join active_objects_by_identity active
			on active."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		group by aliases."archiveUrl"
	), failure_counts_by_identity as (
		select
			"archiveUrlIdentity",
			count(*) filter (where "failureChannel" = 'archive_evidence')::bigint
				as "archiveEvidenceFailures",
			count(*) filter (where "failureChannel" = 'scanner_issue')::bigint
				as "scannerIssueFailures",
			count(*) filter (where "failureChannel" is null)::bigint
				as "unclassifiedFailures"
		from history_archive_object_queue
		where status = 'failed'
		group by "archiveUrlIdentity"
	), failure_counts as (
		select
			aliases."archiveUrl",
			sum(failures."archiveEvidenceFailures")
				as "archiveEvidenceFailures",
			sum(failures."scannerIssueFailures") as "scannerIssueFailures",
			sum(failures."unclassifiedFailures") as "unclassifiedFailures"
		from source_aliases aliases
		join failure_counts_by_identity failures
			on failures."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		group by aliases."archiveUrl"
	), checkpoint_proof as (
		select distinct on (aliases."archiveUrl")
			aliases."archiveUrl",
			proof."latestCheckpointLedger",
			proof."totalCheckpointProofs",
			proof."pendingCheckpointProofs",
			proof."verifiedCheckpointProofs",
			proof."mismatchCheckpointProofs",
			proof."notEvaluableCheckpointProofs",
			proof."objectCompleteCheckpointProofs"
		from source_aliases aliases
		join history_archive_checkpoint_proof_rollup proof
			on proof."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		order by
			aliases."archiveUrl",
			proof."latestCheckpointLedger" desc nulls last,
			proof."totalCheckpointProofs" desc,
			(proof."archiveUrlIdentity" = aliases."archiveUrl") desc,
			proof."archiveUrlIdentity"
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
		proof."latestCheckpointLedger" as "latestDiscoveredCheckpointLedger",
		coalesce(active."activeObjectChecks", 0) as "activeObjectChecks",
		coalesce(failure_counts."archiveEvidenceFailures", 0)
			as "archiveEvidenceFailures",
		coalesce(failure_counts."scannerIssueFailures", 0)
			as "scannerIssueFailures",
		coalesce(failure_counts."unclassifiedFailures", 0)
			as "unclassifiedFailures",
		coalesce(proof."totalCheckpointProofs", 0) as "totalCheckpointProofs",
		coalesce(proof."pendingCheckpointProofs", 0) as "pendingCheckpointProofs",
		coalesce(proof."verifiedCheckpointProofs", 0) as "verifiedCheckpointProofs",
		coalesce(proof."mismatchCheckpointProofs", 0) as "mismatchCheckpointProofs",
		coalesce(proof."notEvaluableCheckpointProofs", 0)
			as "notEvaluableCheckpointProofs",
		coalesce(proof."objectCompleteCheckpointProofs", 0)
			as "objectCompleteCheckpointProofs",
		root_object."rootObjectStatus",
		root_object."rootFailureChannel"
	from current_state state
	left join root_object
		on root_object."archiveUrl" = state."archiveUrl"
	left join checkpoint_proof proof
		on proof."archiveUrl" = state."archiveUrl"
	left join active_objects active
		on active."archiveUrl" = state."archiveUrl"
	left join failure_counts
		on failure_counts."archiveUrl" = state."archiveUrl"
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
	limit $1
`;
