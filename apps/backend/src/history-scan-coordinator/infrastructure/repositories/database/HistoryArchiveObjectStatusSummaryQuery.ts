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

type EvidenceHealthRow = {
	readonly ready?: boolean;
	readonly activeObjectChecks?: NumericValue;
	readonly activeobjectchecks?: NumericValue;
	readonly archiveEvidenceFailures?: NumericValue;
	readonly archiveevidencefailures?: NumericValue;
	readonly scannerIssueFailures?: NumericValue;
	readonly scannerissuefailures?: NumericValue;
	readonly unclassifiedFailures?: NumericValue;
	readonly unclassifiedfailures?: NumericValue;
};

type SourceCountRow = {
	readonly sourceCount?: NumericValue;
	readonly sourcecount?: NumericValue;
};

export const historyArchiveStatusSourceLimit = 256;

export async function getHistoryArchiveObjectStatusSummary(
	manager: EntityManager,
	generatedAt = new Date()
): Promise<HistoryArchiveStatusSummaryV1> {
	const [checkpointCoverage, sources, evidenceHealth, sourceCount] =
		await Promise.all([
			getCheckpointCoverage(manager, null),
			getStatusSourceSummaries(manager),
			getEvidenceHealth(manager),
			getSourceCount(manager)
		]);

	return {
		activeObjectChecks: evidenceHealth.activeObjectChecks,
		archiveEvidenceFailures: evidenceHealth.archiveEvidenceFailures,
		checkpointCoverage,
		generatedAt: generatedAt.toISOString(),
		sourceCount,
		sourceLimit: historyArchiveStatusSourceLimit,
		scannerIssueFailures: evidenceHealth.scannerIssueFailures,
		sources,
		sourcesTruncated: sourceCount > sources.length,
		unclassifiedFailures: evidenceHealth.unclassifiedFailures
	};
}

async function getEvidenceHealth(
	manager: EntityManager
): Promise<EvidenceHealth> {
	const [row] = (await manager.query(
		evidenceHealthSql
	)) as readonly EvidenceHealthRow[];
	if (row?.ready !== true) {
		throw new Error('Archive evidence root summary is not ready');
	}
	return {
		activeObjectChecks: evidenceHealthField(row, 'activeObjectChecks'),
		archiveEvidenceFailures: evidenceHealthField(
			row,
			'archiveEvidenceFailures'
		),
		scannerIssueFailures: evidenceHealthField(row, 'scannerIssueFailures'),
		unclassifiedFailures: evidenceHealthField(row, 'unclassifiedFailures')
	};
}

type EvidenceHealth = Pick<
	HistoryArchiveStatusSummaryV1,
	| 'activeObjectChecks'
	| 'archiveEvidenceFailures'
	| 'scannerIssueFailures'
	| 'unclassifiedFailures'
>;

type EvidenceHealthNumericField = Exclude<keyof EvidenceHealthRow, 'ready'>;

function evidenceHealthField(
	row: EvidenceHealthRow,
	field: EvidenceHealthNumericField
): number {
	return requireNumber(
		row[field] ?? row[lowercaseEvidenceHealth(field)],
		field
	);
}

function lowercaseEvidenceHealth(
	field: EvidenceHealthNumericField
): EvidenceHealthNumericField {
	return field.toLowerCase() as EvidenceHealthNumericField;
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

export const sourceCountSql = `
	select count(distinct "archiveUrl")::int as "sourceCount"
	from history_archive_state_snapshot
`;

export const evidenceHealthSql = `
	select
		progress."complete" as ready,
		coalesce(sum(summary."activeObjects"), 0)::bigint
			as "activeObjectChecks",
		coalesce(sum(summary."remoteFailureObjects"), 0)::bigint
			as "archiveEvidenceFailures",
		coalesce(sum(summary."workerIssueObjects"), 0)::bigint
			as "scannerIssueFailures",
		coalesce(sum(
			summary."totalObjects"
			- summary."pendingObjects"
			- summary."activeObjects"
			- summary."verifiedObjects"
			- summary."remoteFailureObjects"
			- summary."workerIssueObjects"
		), 0)::bigint
			as "unclassifiedFailures"
	from history_archive_evidence_root_summary_progress progress
	left join history_archive_evidence_root_summary summary
		on progress."complete"
	where progress.id = 1
	group by progress."complete"
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
	), object_health as (
		select
			aliases."archiveUrl",
			coalesce(sum(summary."activeObjects"), 0)
				as "activeObjectChecks",
			coalesce(sum(summary."remoteFailureObjects"), 0)
				as "archiveEvidenceFailures",
			coalesce(sum(summary."workerIssueObjects"), 0)
				as "scannerIssueFailures",
			coalesce(sum(
				summary."totalObjects"
				- summary."pendingObjects"
				- summary."activeObjects"
				- summary."verifiedObjects"
				- summary."remoteFailureObjects"
				- summary."workerIssueObjects"
			), 0) as "unclassifiedFailures"
		from source_aliases aliases
		left join history_archive_evidence_root_summary summary
			on summary."archiveUrlIdentity" = aliases."archiveUrlIdentity"
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
		coalesce(object_health."activeObjectChecks", 0) as "activeObjectChecks",
		coalesce(object_health."archiveEvidenceFailures", 0)
			as "archiveEvidenceFailures",
		coalesce(object_health."scannerIssueFailures", 0)
			as "scannerIssueFailures",
		coalesce(object_health."unclassifiedFailures", 0)
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
	left join object_health
		on object_health."archiveUrl" = state."archiveUrl"
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
	limit $1
`;
