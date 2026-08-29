import type { EntityManager } from 'typeorm';
import {
	normalizeHistoryArchiveRootUrl,
	type HistoryArchiveCanonicalProofProgressV1,
	type HistoryArchiveStatusSourceV1,
	type HistoryArchiveStatusSummaryV1
} from 'shared';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';
import { getCheckpointCoverage } from './HistoryArchiveObjectCheckpointCoverageQuery.js';
import { getHistoryArchiveTransitionReconciliation } from './HistoryArchiveTransitionReconciliationQuery.js';

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
	readonly durableVerifiedCheckpointProofs?: NumericValue;
	readonly durableverifiedcheckpointproofs?: NumericValue;
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

export type CanonicalProofProgressRow = {
	readonly archiveUrl?: string | null;
	readonly archiveurl?: string | null;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly currentLedger?: NumericValue | null;
	readonly currentledger?: NumericValue | null;
	readonly frontierStatus?: string | null;
	readonly frontierstatus?: string | null;
	readonly nextHistoricalCheckpointLedger?: NumericValue | null;
	readonly nexthistoricalcheckpointledger?: NumericValue | null;
};

export const historyArchiveStatusSourceLimit = 256;

export async function getHistoryArchiveObjectStatusSummary(
	manager: EntityManager,
	generatedAt = new Date()
): Promise<HistoryArchiveStatusSummaryV1> {
	const [
		checkpointCoverage,
		canonicalProofProgress,
		sources,
		evidenceHealth,
		sourceCount,
		transitionReconciliation
	] = await Promise.all([
		getCheckpointCoverage(manager, null),
		getCanonicalProofProgress(manager),
		getStatusSourceSummaries(manager),
		getEvidenceHealth(manager),
		getSourceCount(manager),
		getHistoryArchiveTransitionReconciliation(manager, generatedAt)
	]);

	return {
		activeObjectChecks: evidenceHealth.activeObjectChecks,
		archiveEvidenceFailures: evidenceHealth.archiveEvidenceFailures,
		canonicalProofProgress,
		checkpointCoverage,
		generatedAt: generatedAt.toISOString(),
		sourceCount,
		sourceLimit: historyArchiveStatusSourceLimit,
		scannerIssueFailures: evidenceHealth.scannerIssueFailures,
		sources,
		sourcesTruncated: sourceCount > sources.length,
		transitionReconciliation,
		unclassifiedFailures: evidenceHealth.unclassifiedFailures
	};
}

async function getCanonicalProofProgress(
	manager: EntityManager
): Promise<HistoryArchiveCanonicalProofProgressV1> {
	const archiveUrlIdentity = normalizeHistoryArchiveRootUrl(
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT ?? ''
	);
	if (archiveUrlIdentity === null) {
		return emptyCanonicalProofProgress(null);
	}
	const [row] = (await manager.query(canonicalProofProgressSql, [
		archiveUrlIdentity
	])) as readonly CanonicalProofProgressRow[];
	if (row === undefined) {
		return emptyCanonicalProofProgress(archiveUrlIdentity);
	}
	return mapCanonicalProofProgress(row, archiveUrlIdentity);
}

function emptyCanonicalProofProgress(
	archiveUrlIdentity: string | null
): HistoryArchiveCanonicalProofProgressV1 {
	return {
		archiveUrl: archiveUrlIdentity,
		archiveUrlIdentity,
		latestVerifiedCheckpointLedger: null,
		nextCheckpointLedger: archiveUrlIdentity === null ? null : 63,
		remainingCheckpoints: 0,
		targetCheckpointLedger: null,
		totalCheckpoints: 0,
		verifiedCheckpoints: 0
	};
}

export function mapCanonicalProofProgress(
	row: CanonicalProofProgressRow,
	fallbackArchiveUrlIdentity: string
): HistoryArchiveCanonicalProofProgressV1 {
	const archiveUrlIdentity =
		row.archiveUrlIdentity ??
		row.archiveurlidentity ??
		fallbackArchiveUrlIdentity;
	const currentLedger = nullableNumber(row.currentLedger ?? row.currentledger);
	const cursor = nullableNumber(
		row.nextHistoricalCheckpointLedger ?? row.nexthistoricalcheckpointledger
	);
	const frontierStatus = row.frontierStatus ?? row.frontierstatus ?? null;
	const latestVerifiedCheckpointLedger =
		cursor === null || cursor <= 63
			? null
			: frontierStatus === 'verified'
				? cursor - 64
				: cursor <= 127
					? null
					: cursor - 128;
	const targetCheckpointLedger =
		currentLedger === null || currentLedger < 63
			? null
			: Math.floor((currentLedger + 1) / 64) * 64 - 1;
	const verifiedCheckpoints =
		latestVerifiedCheckpointLedger === null
			? 0
			: (latestVerifiedCheckpointLedger + 1) / 64;
	const totalCheckpoints =
		targetCheckpointLedger === null ? 0 : (targetCheckpointLedger + 1) / 64;
	return {
		archiveUrl: row.archiveUrl ?? row.archiveurl ?? archiveUrlIdentity,
		archiveUrlIdentity,
		latestVerifiedCheckpointLedger,
		nextCheckpointLedger:
			totalCheckpoints <= verifiedCheckpoints
				? null
				: latestVerifiedCheckpointLedger === null
					? 63
					: latestVerifiedCheckpointLedger + 64,
		remainingCheckpoints: Math.max(0, totalCheckpoints - verifiedCheckpoints),
		targetCheckpointLedger,
		totalCheckpoints,
		verifiedCheckpoints
	};
}

async function getEvidenceHealth(
	manager: EntityManager
): Promise<EvidenceHealth> {
	const [row] = (await manager.query(
		evidenceHealthSql
	)) as readonly EvidenceHealthRow[];
	if (row?.ready !== true) {
		throw new Error('Archive evidence summaries are not ready');
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
		durableVerifiedCheckpointProofs: numberField(
			row,
			'durableVerifiedCheckpointProofs'
		),
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
	if (
		value === 'archive_evidence' ||
		value === 'archive_availability' ||
		value === 'scanner_issue'
	) {
		return value;
	}
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

export const canonicalProofProgressSql = `
	select
		state."archiveUrl",
		cursor."archiveUrlIdentity",
		state."currentLedger",
		cursor."nextHistoricalCheckpointLedger",
		frontier.status as "frontierStatus"
	from history_archive_checkpoint_scan_cursor cursor
	left join history_archive_state_snapshot state
		on state."archiveUrlIdentity" = cursor."archiveUrlIdentity"
	left join history_archive_checkpoint_proof frontier
		on frontier."archiveUrlIdentity" = cursor."archiveUrlIdentity"
		and frontier."checkpointLedger" =
			cursor."nextHistoricalCheckpointLedger" - 64
	where cursor."archiveUrlIdentity" = $1
	limit 1
`;

export const sourceCountSql = `
	select count(distinct "archiveUrl")::int as "sourceCount"
	from history_archive_state_snapshot
`;

export const evidenceHealthSql = `
	with rollup_readiness as materialized (
		select
			coalesce((
				select "complete" and "lastObjectId" = "cutoffObjectId"
				from history_archive_evidence_root_summary_progress
				where id = 1
			), false)
			and coalesce((
				select "complete" and "lastProofId" = "cutoffProofId"
				from history_archive_checkpoint_proof_rollup_progress
				where id = 1
			), false) as ready
	)
	select
		rollup_readiness.ready,
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
	from rollup_readiness
	left join history_archive_evidence_root_summary summary
		on rollup_readiness.ready
	group by rollup_readiness.ready
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
			coalesce(current_proof."pendingCheckpointProofs", 0)
				as "pendingCheckpointProofs",
			coalesce(current_proof."verifiedCheckpointProofs", 0)
				as "verifiedCheckpointProofs",
			coalesce(durable_proof."durableVerifiedCheckpointProofs", 0)
				as "durableVerifiedCheckpointProofs",
			coalesce(current_proof."mismatchCheckpointProofs", 0)
				as "mismatchCheckpointProofs",
			coalesce(current_proof."notEvaluableCheckpointProofs", 0)
				+ greatest(
					proof."totalCheckpointProofs"
						- coalesce(current_proof."totalCheckpointProofs", 0),
					0
				) as "notEvaluableCheckpointProofs",
			coalesce(current_proof."objectCompleteCheckpointProofs", 0)
				as "objectCompleteCheckpointProofs"
		from source_aliases aliases
		join history_archive_checkpoint_proof_rollup proof
			on proof."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		left join history_archive_checkpoint_proof_version_rollup current_proof
			on current_proof."archiveUrlIdentity" = proof."archiveUrlIdentity"
			and current_proof."proofVersion" =
				${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		left join history_archive_checkpoint_proof_attestation_rollup durable_proof
			on durable_proof."archiveUrlIdentity" = proof."archiveUrlIdentity"
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
		coalesce(proof."durableVerifiedCheckpointProofs", 0)
			as "durableVerifiedCheckpointProofs",
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
