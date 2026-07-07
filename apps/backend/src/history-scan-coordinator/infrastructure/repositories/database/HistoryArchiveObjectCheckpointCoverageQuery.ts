import type { EntityManager } from 'typeorm';
import type { HistoryArchiveCheckpointCoverageV1 } from 'shared';
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

const checkpointCoverageSql = `
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
	proof_rows as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			status,
			"requiredObjectsComplete"
		from history_archive_checkpoint_proof
		where ${archiveFilterSql}
	),
	root_coverage as (
		select
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount",
			count(distinct proof_rows."checkpointLedger")
				as "scheduledCheckpointCount",
			min(proof_rows."checkpointLedger") as "oldestCheckpointLedger"
		from root_state
		left join proof_rows
			on proof_rows."archiveUrlIdentity" = root_state."archiveUrlIdentity"
		group by
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount"
	),
	proof_summary as (
		select
			count(*) as "totalArchiveCheckpoints",
			count(*) filter (where false) as "activeArchiveCheckpoints",
			count(*) filter (where status = 'mismatch') as "failedArchiveCheckpoints",
			count(*) filter (where "requiredObjectsComplete")
				as "completeArchiveCheckpoints",
			count(*) filter (where "requiredObjectsComplete")
				as "objectCompleteArchiveCheckpoints",
			count(*) filter (where status = 'verified')
				as "categoryConsistentArchiveCheckpoints",
			count(*) filter (where status = 'mismatch')
				as "categoryConsistencyFailedCheckpoints",
			count(*) filter (where status = 'not-evaluable')
				as "categoryConsistencyNotEvaluatedCheckpoints",
			count(*) filter (where status = 'pending')
				as "categoryConsistencyPendingCheckpoints",
			count(*) filter (where status = 'pending')
				as "partialArchiveCheckpoints",
			min("checkpointLedger") as "oldestCheckpointLedger",
			max("checkpointLedger") as "latestCheckpointLedger"
		from proof_rows
	)
	select
		"totalArchiveCheckpoints",
		"activeArchiveCheckpoints",
		"failedArchiveCheckpoints",
		"completeArchiveCheckpoints",
		"objectCompleteArchiveCheckpoints",
		"categoryConsistentArchiveCheckpoints",
		"categoryConsistencyFailedCheckpoints",
		"categoryConsistencyNotEvaluatedCheckpoints",
		"categoryConsistencyPendingCheckpoints",
		"partialArchiveCheckpoints",
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
`;
