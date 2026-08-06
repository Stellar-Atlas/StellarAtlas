import type { EntityManager } from 'typeorm';
import type { HistoryArchiveCheckpointCoverageV1 } from 'shared';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type CheckpointCoverageRow = {
	readonly activeArchiveCheckpoints?: NumericValue;
	readonly activearchivecheckpoints?: NumericValue;
	readonly archiveRootsWithState?: NumericValue;
	readonly archiverootswithstate?: NumericValue;
	readonly categoryConsistencyFailedCheckpoints?: NumericValue;
	readonly categoryconsistencyfailedcheckpoints?: NumericValue;
	readonly categoryConsistencyNotEvaluatedCheckpoints?: NumericValue;
	readonly categoryconsistencynotevaluatedcheckpoints?: NumericValue;
	readonly categoryConsistencyPendingCheckpoints?: NumericValue;
	readonly categoryconsistencypendingcheckpoints?: NumericValue;
	readonly categoryConsistentArchiveCheckpoints?: NumericValue;
	readonly categoryconsistentarchivecheckpoints?: NumericValue;
	readonly completeArchiveCheckpoints?: NumericValue;
	readonly completearchivecheckpoints?: NumericValue;
	readonly durableVerifiedArchiveCheckpoints?: NumericValue;
	readonly durableverifiedarchivecheckpoints?: NumericValue;
	readonly discoveryCompleteArchiveRoots?: NumericValue;
	readonly discoverycompletearchiveroots?: NumericValue;
	readonly expectedArchiveCheckpoints?: NumericValue;
	readonly expectedarchivecheckpoints?: NumericValue;
	readonly failedArchiveCheckpoints?: NumericValue;
	readonly failedarchivecheckpoints?: NumericValue;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly missingArchiveCheckpoints?: NumericValue;
	readonly missingarchivecheckpoints?: NumericValue;
	readonly objectCompleteArchiveCheckpoints?: NumericValue;
	readonly objectcompletearchivecheckpoints?: NumericValue;
	readonly oldestCheckpointLedger?: NumericValue | null;
	readonly oldestcheckpointledger?: NumericValue | null;
	readonly partialArchiveCheckpoints?: NumericValue;
	readonly partialarchivecheckpoints?: NumericValue;
	readonly totalArchiveCheckpoints?: NumericValue;
	readonly totalarchivecheckpoints?: NumericValue;
};

export async function getCheckpointCoverage(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<HistoryArchiveCheckpointCoverageV1> {
	const [row] = (await manager.query(checkpointCoverageSql, [
		archiveUrlIdentity
	])) as readonly CheckpointCoverageRow[];

	return {
		activeArchiveCheckpoints: numberField(row, 'activeArchiveCheckpoints'),
		archiveRootsWithState: numberField(row, 'archiveRootsWithState'),
		categoryConsistencyFailedCheckpoints: numberField(
			row,
			'categoryConsistencyFailedCheckpoints'
		),
		categoryConsistencyNotEvaluatedCheckpoints: numberField(
			row,
			'categoryConsistencyNotEvaluatedCheckpoints'
		),
		categoryConsistencyPendingCheckpoints: numberField(
			row,
			'categoryConsistencyPendingCheckpoints'
		),
		categoryConsistentArchiveCheckpoints: numberField(
			row,
			'categoryConsistentArchiveCheckpoints'
		),
		completeArchiveCheckpoints: numberField(row, 'completeArchiveCheckpoints'),
		durableVerifiedArchiveCheckpoints: numberField(
			row,
			'durableVerifiedArchiveCheckpoints'
		),
		discoveryCompleteArchiveRoots: numberField(
			row,
			'discoveryCompleteArchiveRoots'
		),
		expectedArchiveCheckpoints: numberField(row, 'expectedArchiveCheckpoints'),
		failedArchiveCheckpoints: numberField(row, 'failedArchiveCheckpoints'),
		latestCheckpointLedger: nullableNumberField(row, 'latestCheckpointLedger'),
		missingArchiveCheckpoints: numberField(row, 'missingArchiveCheckpoints'),
		objectCompleteArchiveCheckpoints: numberField(
			row,
			'objectCompleteArchiveCheckpoints'
		),
		oldestCheckpointLedger: nullableNumberField(row, 'oldestCheckpointLedger'),
		partialArchiveCheckpoints: numberField(row, 'partialArchiveCheckpoints'),
		totalArchiveCheckpoints: numberField(row, 'totalArchiveCheckpoints')
	};
}

function numberField(
	row: CheckpointCoverageRow | undefined,
	field: keyof CheckpointCoverageRow
): number {
	return requireNumber(
		row?.[field] ?? row?.[lowercase(field)] ?? undefined,
		field
	);
}

function nullableNumberField(
	row: CheckpointCoverageRow | undefined,
	field: keyof CheckpointCoverageRow
): number | null {
	const value = row?.[field] ?? row?.[lowercase(field)];
	if (value === null || value === undefined) return null;
	return requireNumber(value, field);
}

function lowercase(
	field: keyof CheckpointCoverageRow
): keyof CheckpointCoverageRow {
	return field.toLowerCase() as keyof CheckpointCoverageRow;
}

const archiveFilterSql =
	'($1::text is null or "archiveUrlIdentity" = $1::text)';

export const checkpointCoverageSql = `
	with root_state as (
		select
			"archiveUrlIdentity",
			floor((greatest("currentLedger", 63) + 1)::numeric / 64)::integer
				as "expectedCheckpointCount"
		from history_archive_state_snapshot
		where ${archiveFilterSql}
			and status = 'available'
			and "currentLedger" is not null
			and "currentLedger" >= 0
	),
	selected_rollup as (
		select *
		from history_archive_checkpoint_proof_rollup
		where ${archiveFilterSql}
	), selected_current_rollup as (
		select *
		from history_archive_checkpoint_proof_version_rollup
		where ${archiveFilterSql}
			and "proofVersion" =
				${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
	), active_checkpoints as (
		select "archiveUrlIdentity", "checkpointLedger"
		from history_archive_object_queue
		where ${archiveFilterSql}
			and status = 'scanning'
			and "checkpointLedger" is not null
		group by "archiveUrlIdentity", "checkpointLedger"
	),
	root_coverage as (
		select
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount",
			coalesce(selected_rollup."totalCheckpointProofs", 0)
				as "scheduledCheckpointCount",
			selected_rollup."oldestCheckpointLedger"
		from root_state
		left join selected_rollup
			on selected_rollup."archiveUrlIdentity" = root_state."archiveUrlIdentity"
	),
	proof_summary as (
		select
			coalesce(sum("totalCheckpointProofs"), 0)
				as "totalArchiveCheckpoints",
			(select count(*) from active_checkpoints)
				as "activeArchiveCheckpoints",
			coalesce(sum("mismatchCheckpointProofs"), 0)
				as "failedArchiveCheckpoints",
			coalesce(sum("objectCompleteCheckpointProofs"), 0)
				as "completeArchiveCheckpoints",
			coalesce(sum("objectCompleteCheckpointProofs"), 0)
				as "objectCompleteArchiveCheckpoints",
			coalesce(sum("verifiedCheckpointProofs"), 0)
				as "categoryConsistentArchiveCheckpoints",
			coalesce(sum("mismatchCheckpointProofs"), 0)
				as "categoryConsistencyFailedCheckpoints",
			coalesce(sum("notEvaluableCheckpointProofs"), 0)
				as "categoryConsistencyNotEvaluatedCheckpoints",
			coalesce(sum("pendingCheckpointProofs"), 0)
				as "categoryConsistencyPendingCheckpoints",
			coalesce(sum("pendingCheckpointProofs"), 0)
				as "partialArchiveCheckpoints",
			min("oldestCheckpointLedger") as "oldestCheckpointLedger",
			max("latestCheckpointLedger") as "latestCheckpointLedger"
		from selected_rollup
	), current_proof_summary as (
		select
			coalesce(sum("totalCheckpointProofs"), 0)
				as "currentTotalCheckpointProofs",
			coalesce(sum("mismatchCheckpointProofs"), 0)
				as "currentMismatchCheckpointProofs",
			coalesce(sum("objectCompleteCheckpointProofs"), 0)
				as "currentObjectCompleteCheckpointProofs",
			coalesce(sum("verifiedCheckpointProofs"), 0)
				as "currentVerifiedCheckpointProofs",
			coalesce(sum("notEvaluableCheckpointProofs"), 0)
				as "currentNotEvaluableCheckpointProofs",
			coalesce(sum("pendingCheckpointProofs"), 0)
				as "currentPendingCheckpointProofs"
		from selected_current_rollup
	), durable_proof_summary as (
		select coalesce(sum("durableVerifiedCheckpointProofs"), 0)
			as "durableVerifiedArchiveCheckpoints"
		from history_archive_checkpoint_proof_attestation_rollup
		where ${archiveFilterSql}
	)
	select
		"totalArchiveCheckpoints",
		"activeArchiveCheckpoints",
		"currentMismatchCheckpointProofs" as "failedArchiveCheckpoints",
		"currentObjectCompleteCheckpointProofs" as "completeArchiveCheckpoints",
		"currentObjectCompleteCheckpointProofs"
			as "objectCompleteArchiveCheckpoints",
		"durableVerifiedArchiveCheckpoints",
		"currentVerifiedCheckpointProofs"
			as "categoryConsistentArchiveCheckpoints",
		"currentMismatchCheckpointProofs"
			as "categoryConsistencyFailedCheckpoints",
		"currentNotEvaluableCheckpointProofs" + greatest(
			"totalArchiveCheckpoints" - "currentTotalCheckpointProofs",
			0
		) as "categoryConsistencyNotEvaluatedCheckpoints",
		"currentPendingCheckpointProofs"
			as "categoryConsistencyPendingCheckpoints",
		"currentPendingCheckpointProofs" + greatest(
			"totalArchiveCheckpoints" - "currentTotalCheckpointProofs",
			0
		) as "partialArchiveCheckpoints",
		"oldestCheckpointLedger",
		"latestCheckpointLedger",
		coalesce((select count(*) from root_coverage), 0)
			as "archiveRootsWithState",
		coalesce(
			(select sum("expectedCheckpointCount") from root_coverage),
			0
		) as "expectedArchiveCheckpoints",
		coalesce(
			(
				select sum(
					greatest(
						"expectedCheckpointCount" - "scheduledCheckpointCount",
						0
					)
				)
				from root_coverage
			),
			0
		) as "missingArchiveCheckpoints",
		coalesce(
			(
				select count(*)
				from root_coverage
				where "expectedCheckpointCount" > 0
					and "scheduledCheckpointCount" >= "expectedCheckpointCount"
					and "oldestCheckpointLedger" <= 63
			),
			0
		) as "discoveryCompleteArchiveRoots"
	from proof_summary
	cross join current_proof_summary
	cross join durable_proof_summary
`;
