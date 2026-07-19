import type { EntityManager } from 'typeorm';
import type { HistoryArchiveRepairPlanSummary } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveObjectHostThrottles } from './HistoryArchiveObjectHostThrottleSummaryQuery.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type RepairPlanSummaryRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly failedCheckpointProofs?: NumericValue;
	readonly failedcheckpointproofs?: NumericValue;
	readonly objectRollupComplete?: boolean;
	readonly objectrollupcomplete?: boolean;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly proofRollupComplete?: boolean;
	readonly proofrollupcomplete?: boolean;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
};

export async function getHistoryArchiveRepairPlanSummary(
	manager: EntityManager,
	archiveUrlIdentity: string
): Promise<HistoryArchiveRepairPlanSummary> {
	const [summaryRows, hostThrottles] = await Promise.all([
		manager.query(historyArchiveRepairPlanSummarySql, [
			archiveUrlIdentity
		]) as Promise<readonly RepairPlanSummaryRow[]>,
		getHistoryArchiveObjectHostThrottles(manager, archiveUrlIdentity)
	]);
	const row = summaryRows[0];
	if (
		(row?.objectRollupComplete ?? row?.objectrollupcomplete) !== true ||
		(row?.proofRollupComplete ?? row?.proofrollupcomplete) !== true
	) {
		throw new Error('Archive repair plan evidence rollups are not ready');
	}

	const activeObjects = numberField(row, 'activeObjects');
	const pendingObjects = numberField(row, 'pendingObjects');
	const totalObjects = numberField(row, 'totalObjects');
	const verifiedObjects = numberField(row, 'verifiedObjects');
	const failedObjects =
		totalObjects - activeObjects - pendingObjects - verifiedObjects;
	if (failedObjects < 0) {
		throw new Error(
			'Archive repair plan object rollup counts are inconsistent'
		);
	}

	return {
		activeObjects,
		failedCheckpointProofs: numberField(row, 'failedCheckpointProofs'),
		failedObjects,
		hostThrottles,
		pendingObjects,
		verifiedObjects
	};
}

function numberField(
	row: RepairPlanSummaryRow | undefined,
	field:
		| 'activeObjects'
		| 'failedCheckpointProofs'
		| 'pendingObjects'
		| 'totalObjects'
		| 'verifiedObjects'
): number {
	if (field === 'activeObjects') {
		return requireNumber(
			row?.activeObjects ?? row?.activeobjects,
			'activeObjects'
		);
	}
	if (field === 'failedCheckpointProofs') {
		return requireNumber(
			row?.failedCheckpointProofs ?? row?.failedcheckpointproofs,
			'failedCheckpointProofs'
		);
	}
	if (field === 'pendingObjects') {
		return requireNumber(
			row?.pendingObjects ?? row?.pendingobjects,
			'pendingObjects'
		);
	}
	if (field === 'totalObjects') {
		return requireNumber(
			row?.totalObjects ?? row?.totalobjects,
			'totalObjects'
		);
	}
	return requireNumber(
		row?.verifiedObjects ?? row?.verifiedobjects,
		'verifiedObjects'
	);
}

export const historyArchiveRepairPlanSummarySql = `
	select
		coalesce(object_summary."totalObjects", 0) as "totalObjects",
		coalesce(object_summary."pendingObjects", 0) as "pendingObjects",
		coalesce(object_summary."activeObjects", 0) as "activeObjects",
		coalesce(object_summary."verifiedObjects", 0) as "verifiedObjects",
		coalesce(proof_summary."mismatchCheckpointProofs", 0)
			as "failedCheckpointProofs",
		coalesce((
			select "complete"
			from history_archive_evidence_root_summary_progress
			where id = 1
		), false) as "objectRollupComplete",
		coalesce((
			select "complete"
			from history_archive_checkpoint_proof_rollup_progress
			where id = 1
		), false) as "proofRollupComplete"
	from (values ($1::text)) requested("archiveUrlIdentity")
	left join history_archive_evidence_root_summary object_summary
		on object_summary."archiveUrlIdentity" = requested."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_rollup proof_summary
		on proof_summary."archiveUrlIdentity" = requested."archiveUrlIdentity"
`;
