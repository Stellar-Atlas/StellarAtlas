import type { DataSource } from 'typeorm';

export async function createEvidenceSummarySchema(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		create table history_archive_evidence_root_summary (
			"archiveUrlIdentity" text primary key,
			"totalObjects" bigint not null,
			"pendingObjects" bigint not null,
			"activeObjects" bigint not null,
			"verifiedObjects" bigint not null,
			"remoteFailureObjects" bigint not null,
			"workerIssueObjects" bigint not null,
			"bucketObjects" bigint not null,
			"verifiedBucketObjects" bigint not null
		)
	`);
	await dataSource.query(`
		create table history_archive_evidence_root_summary_progress (
			id smallint primary key,
			"complete" boolean not null
		)
	`);
}

export async function populateEvidenceSummary(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		insert into history_archive_evidence_root_summary (
			"archiveUrlIdentity", "totalObjects", "pendingObjects",
			"activeObjects", "verifiedObjects", "remoteFailureObjects",
			"workerIssueObjects", "bucketObjects", "verifiedBucketObjects"
		)
		select
			"archiveUrlIdentity",
			count(*),
			count(*) filter (where status = 'pending'),
			count(*) filter (where status = 'scanning'),
			count(*) filter (where status = 'verified'),
			count(*) filter (
				where status = 'failed' and "failureChannel" = 'archive_evidence'
			),
			count(*) filter (
				where status = 'failed' and "failureChannel" = 'scanner_issue'
			),
			count(*) filter (where "objectType" = 'bucket'),
			count(*) filter (
				where "objectType" = 'bucket' and status = 'verified'
			)
		from history_archive_object_queue
		group by "archiveUrlIdentity"
	`);
	await dataSource.query(`
		insert into history_archive_evidence_root_summary_progress (id, "complete")
		values (1, true)
	`);
}

export async function populateCheckpointProofScaleFixture(
	dataSource: DataSource,
	archiveCount: number,
	checkpointsPerArchive: number
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await runner.query(`set local synchronous_commit = off`);
		await runner.query(
			'alter table history_archive_checkpoint_proof disable trigger user'
		);
		await runner.query(
			`insert into history_archive_checkpoint_proof (
				"archiveUrlIdentity", "checkpointLedger", status,
				"requiredObjectsComplete"
			 )
			 select state."archiveUrlIdentity", (checkpoint * 64) - 1,
				case checkpoint % 4
					when 0 then 'verified'
					when 1 then 'pending'
					when 2 then 'mismatch'
					else 'not-evaluable'
				end,
				checkpoint % 3 = 0
				 from (
					select "archiveUrlIdentity"
					from history_archive_state_snapshot
					order by "archiveUrlIdentity"
					limit $1::integer
				 ) state
				 cross join generate_series(1, $2::integer) checkpoint`,
			[archiveCount, checkpointsPerArchive]
		);
		await runner.query(
			'alter table history_archive_checkpoint_proof enable trigger user'
		);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}
