import { MigrationInterface, QueryRunner } from 'typeorm';

const objectTypeCodeMax = 7;
const workerOutcomeCodeMax = 4;
const workerStageCodeMax = 20;

export class HistoryArchiveWorkerStatusMigration1784790000000 implements MigrationInterface {
	name = 'HistoryArchiveWorkerStatusMigration1784790000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_worker_status" (
				"id" serial not null,
				"workerId" varchar(96) not null,
				"processId" uuid not null,
				"pid" integer not null,
				"processGeneration" integer not null,
				"processStartedAt" timestamptz not null,
				"sequence" bigint not null,
				"objectRemoteId" uuid,
				"objectTypeCode" smallint,
				"objectSource" varchar(2048),
				"stageCode" smallint not null,
				"bytesDownloaded" bigint,
				"claimAttempt" integer,
				"heartbeatAt" timestamptz not null,
				"lastOutcomeCode" smallint not null,
				"lastOutcomeAt" timestamptz,
				constraint "PK_history_archive_worker_status" primary key ("id"),
				constraint "UQ_history_archive_worker_status_worker"
					unique ("workerId"),
				constraint "CHK_history_archive_worker_status_pid"
					check ("pid" > 0),
				constraint "CHK_history_archive_worker_status_generation"
					check ("processGeneration" >= 0),
				constraint "CHK_history_archive_worker_status_sequence"
					check ("sequence" > 0),
				constraint "CHK_history_archive_worker_status_stage"
					check ("stageCode" between 0 and ${workerStageCodeMax}),
				constraint "CHK_history_archive_worker_status_object_type"
					check (
						"objectTypeCode" is null
						or "objectTypeCode" between 1 and ${objectTypeCodeMax}
					),
				constraint "CHK_history_archive_worker_status_outcome"
					check (
						"lastOutcomeCode" between 0 and ${workerOutcomeCodeMax}
					),
				constraint "CHK_history_archive_worker_status_bytes"
					check ("bytesDownloaded" is null or "bytesDownloaded" >= 0),
				constraint "CHK_history_archive_worker_status_attempt"
					check ("claimAttempt" is null or "claimAttempt" > 0),
				constraint "CHK_history_archive_worker_status_activity"
					check (
						(
							"stageCode" = 0
							and "objectRemoteId" is null
							and "objectTypeCode" is null
							and "objectSource" is null
							and "bytesDownloaded" is null
							and "claimAttempt" is null
						)
						or (
							"stageCode" > 0
							and "objectRemoteId" is not null
							and "objectTypeCode" is not null
							and "objectSource" is not null
							and "claimAttempt" is not null
						)
					),
				constraint "CHK_history_archive_worker_status_last_outcome"
					check (
						("lastOutcomeCode" = 0 and "lastOutcomeAt" is null)
						or ("lastOutcomeCode" > 0 and "lastOutcomeAt" is not null)
					)
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_worker_status_heartbeat"
			on "history_archive_worker_status" ("heartbeatAt" desc)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_worker_status_object"
			on "history_archive_worker_status" ("objectRemoteId")
			where "objectRemoteId" is not null
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_worker_status"
		`);
	}
}
