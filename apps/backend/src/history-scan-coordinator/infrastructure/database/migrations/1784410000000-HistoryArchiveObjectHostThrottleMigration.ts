import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectHostThrottleMigration1784410000000 implements MigrationInterface {
	name = 'HistoryArchiveObjectHostThrottleMigration1784410000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_object_host_throttle" (
				"hostIdentity" text not null,
				"archiveUrlIdentity" text not null,
				"failureClass" text not null,
				"evidenceClass" text not null,
				"errorType" text not null,
				"httpStatus" integer,
				"blockedUntil" timestamptz not null,
				"lastFailureAt" timestamptz not null,
				"consecutiveFailures" integer not null default 1,
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_host_throttle"
					primary key ("hostIdentity"),
				constraint "CHK_history_archive_object_host_throttle_failure"
					check ("failureClass" in (
						'http',
						'auth',
						'not-found',
						'rate-limit',
						'timeout',
						'transport',
						'worker',
						'coordinator',
						'unknown'
					)),
				constraint "CHK_history_archive_object_host_throttle_evidence"
					check ("evidenceClass" in (
						'archive-object',
						'worker-infrastructure',
						'coordinator-infrastructure'
					)),
				constraint "CHK_history_archive_object_host_throttle_count"
					check ("consecutiveFailures" >= 1)
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_host_throttle_until"
			on "history_archive_object_host_throttle" ("blockedUntil")
		`);
		await queryRunner.query(`
			insert into "history_archive_object_host_throttle" (
				"hostIdentity",
				"archiveUrlIdentity",
				"failureClass",
				"evidenceClass",
				"errorType",
				"httpStatus",
				"blockedUntil",
				"lastFailureAt",
				"consecutiveFailures",
				"createdAt",
				"updatedAt"
			)
			select distinct on ("hostIdentity")
				"hostIdentity",
				"archiveUrlIdentity",
				failure_class,
				evidence_class,
				coalesce("errorType", 'unknown'),
				"httpStatus",
				"nextAttemptAt",
				"updatedAt",
				greatest("attempts", 1),
				now(),
				now()
			from (
				select
					"hostIdentity",
					"archiveUrlIdentity",
					"errorType",
					"httpStatus",
					"nextAttemptAt",
					"updatedAt",
					"attempts",
					case
						when "httpStatus" in (401, 403)
							or upper(coalesce("errorType", '')) like '%AUTH%'
							or upper(coalesce("errorType", '')) like '%FORBIDDEN%'
							then 'auth'
						when "httpStatus" in (404, 410)
							or upper(coalesce("errorType", '')) like '%NOT_FOUND%'
							or upper(coalesce("errorType", '')) like '%MISSING%'
							then 'not-found'
						when "httpStatus" = 429
							or upper(coalesce("errorType", '')) like '%RATE_LIMIT%'
							or upper(coalesce("errorType", '')) like '%TOO_MANY_REQUESTS%'
							then 'rate-limit'
						when "httpStatus" in (408, 504)
							or upper(coalesce("errorType", '')) like '%TIMEOUT%'
							or upper(coalesce("errorType", '')) like '%TIMEDOUT%'
							or upper(coalesce("errorType", '')) like '%ABORT%'
							then 'timeout'
						when upper(coalesce("errorType", '')) like '%ECONN%'
							or upper(coalesce("errorType", '')) like '%EAI_%'
							or upper(coalesce("errorType", '')) like '%ENOTFOUND%'
							or upper(coalesce("errorType", '')) like '%NETWORK%'
							or upper(coalesce("errorType", '')) like '%SOCKET%'
							or upper(coalesce("errorType", '')) like '%TLS%'
							or upper(coalesce("errorType", '')) like '%TRANSPORT%'
							then 'transport'
						when upper(coalesce("errorType", '')) like '%WORKER%'
							or upper(coalesce("errorType", '')) like '%SCANNER%'
							then 'worker'
						when upper(coalesce("errorType", '')) like '%COORDINATOR%'
							or upper(coalesce("errorType", '')) like '%CLAIM%'
							or upper(coalesce("errorType", '')) like '%LEASE%'
							then 'coordinator'
						when "httpStatus" >= 400 then 'http'
						else 'unknown'
					end as failure_class,
					case
						when upper(coalesce("errorType", '')) like '%WORKER%'
							or upper(coalesce("errorType", '')) like '%SCANNER%'
							then 'worker-infrastructure'
						when upper(coalesce("errorType", '')) like '%COORDINATOR%'
							or upper(coalesce("errorType", '')) like '%CLAIM%'
							or upper(coalesce("errorType", '')) like '%LEASE%'
							then 'coordinator-infrastructure'
						else 'archive-object'
					end as evidence_class
				from "history_archive_object_queue"
				where "hostIdentity" is not null
					and status = 'failed'
					and "nextAttemptAt" > now()
			) latest_failure
			order by "hostIdentity", "updatedAt" desc
			on conflict ("hostIdentity")
			do update set
				"archiveUrlIdentity" = excluded."archiveUrlIdentity",
				"failureClass" = excluded."failureClass",
				"evidenceClass" = excluded."evidenceClass",
				"errorType" = excluded."errorType",
				"httpStatus" = excluded."httpStatus",
				"blockedUntil" = greatest(
					"history_archive_object_host_throttle"."blockedUntil",
					excluded."blockedUntil"
				),
				"lastFailureAt" = excluded."lastFailureAt",
				"consecutiveFailures" = greatest(
					"history_archive_object_host_throttle"."consecutiveFailures",
					excluded."consecutiveFailures"
				),
				"updatedAt" = now()
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists "idx_history_archive_object_host_throttle_until"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_object_host_throttle"
		`);
	}
}
