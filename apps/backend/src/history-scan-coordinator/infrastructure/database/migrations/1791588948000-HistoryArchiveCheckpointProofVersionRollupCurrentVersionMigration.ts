import type { MigrationInterface, QueryRunner } from 'typeorm';

const viewName = 'history_archive_checkpoint_proof_version_rollup';
const currentProofVersion = 10;

const originalViewSql = `
	create or replace view "${viewName}" as
	select
		"archiveUrlIdentity",
		"proofVersion",
		count(*) as "totalCheckpointProofs",
		count(*) filter (where status = 'pending') as "pendingCheckpointProofs",
		count(*) filter (where status = 'verified') as "verifiedCheckpointProofs",
		count(*) filter (where status = 'mismatch') as "mismatchCheckpointProofs",
		count(*) filter (where status = 'not-evaluable') as "notEvaluableCheckpointProofs",
		count(*) filter (where "requiredObjectsComplete") as "objectCompleteCheckpointProofs"
	from history_archive_checkpoint_proof
	group by "archiveUrlIdentity", "proofVersion"
`;

const optimizedViewSql = `
	create or replace view "${viewName}" as
	with other_versions as materialized (
		select
			"archiveUrlIdentity",
			"proofVersion",
			count(*) as "totalCheckpointProofs",
			count(*) filter (where status = 'pending') as "pendingCheckpointProofs",
			count(*) filter (where status = 'verified') as "verifiedCheckpointProofs",
			count(*) filter (where status = 'mismatch') as "mismatchCheckpointProofs",
			count(*) filter (where status = 'not-evaluable') as "notEvaluableCheckpointProofs",
			count(*) filter (where "requiredObjectsComplete") as "objectCompleteCheckpointProofs"
		from history_archive_checkpoint_proof
		where "proofVersion" < ${currentProofVersion}
			or "proofVersion" > ${currentProofVersion}
		group by "archiveUrlIdentity", "proofVersion"
	), other_totals as (
		select
			"archiveUrlIdentity",
			sum("totalCheckpointProofs")::bigint as total,
			sum("pendingCheckpointProofs")::bigint as pending,
			sum("verifiedCheckpointProofs")::bigint as verified,
			sum("mismatchCheckpointProofs")::bigint as mismatch,
			sum("notEvaluableCheckpointProofs")::bigint as not_evaluable,
			sum("objectCompleteCheckpointProofs")::bigint as object_complete
		from other_versions
		group by "archiveUrlIdentity"
	), current_version as (
		select
			all_versions."archiveUrlIdentity",
			${currentProofVersion}::smallint as "proofVersion",
			all_versions."totalCheckpointProofs" - coalesce(other.total, 0) as "totalCheckpointProofs",
			all_versions."pendingCheckpointProofs" - coalesce(other.pending, 0) as "pendingCheckpointProofs",
			all_versions."verifiedCheckpointProofs" - coalesce(other.verified, 0) as "verifiedCheckpointProofs",
			all_versions."mismatchCheckpointProofs" - coalesce(other.mismatch, 0) as "mismatchCheckpointProofs",
			all_versions."notEvaluableCheckpointProofs" - coalesce(other.not_evaluable, 0) as "notEvaluableCheckpointProofs",
			all_versions."objectCompleteCheckpointProofs" - coalesce(other.object_complete, 0) as "objectCompleteCheckpointProofs"
		from history_archive_checkpoint_proof_rollup all_versions
		left join other_totals other using ("archiveUrlIdentity")
		where all_versions."totalCheckpointProofs" - coalesce(other.total, 0) > 0
	)
	select * from other_versions
	union all
	select * from current_version
`;

export class HistoryArchiveCheckpointProofVersionRollupCurrentVersionMigration1791588948000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofVersionRollupCurrentVersionMigration1791588948000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(optimizedViewSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(originalViewSql);
	}
}
