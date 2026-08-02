import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveGenesisCheckpointSchedulingMigration1785320000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveGenesisCheckpointSchedulingMigration1785320000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			with roots as materialized (
				select state."archiveUrl", state."archiveUrlIdentity",
					root."hostIdentity"
				from "history_archive_state_snapshot" state
				join lateral (
					select object."hostIdentity"
					from "history_archive_object_queue" object
					where object."archiveUrlIdentity" = state."archiveUrlIdentity"
						and object."objectType" = 'history-archive-state'
					order by object."updatedAt" desc, object.id desc
					limit 1
				) root on true
				where state.status = 'available'
			), scheduled as (
				insert into "history_archive_object_queue" as stored (
					"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
					"objectType", "objectKey", "objectOrder", "objectUrl", status,
					"checkpointLedger", "dependencyReady", "executionDisposition",
					"executionReason", "executionDispositionAt", "createdAt", "updatedAt"
				)
				select gen_random_uuid(), root."archiveUrl", root."archiveUrlIdentity",
					root."hostIdentity", 'checkpoint-state',
					'checkpoint-state:0000003f', 10,
					rtrim(root."archiveUrl", '/') ||
						'/history/00/00/00/history-0000003f.json',
					'pending', 63, true, 'executable',
					'canonical-frontier-reserve', now(), now(), now()
				from roots root
				on conflict ("archiveUrlIdentity", "objectType", "objectKey")
				do update set
					"dependencyReady" = true,
					"executionDisposition" = 'executable',
					"executionReason" = 'canonical-frontier-reserve',
					"executionDispositionAt" = now(),
					"updatedAt" = now()
				where stored.status in ('pending', 'failed')
				returning "remoteId", "archiveUrlIdentity",
					coalesce("nextAttemptAt", now()) as "availableAt"
			)
			insert into "history_archive_object_ready" as ready (
				"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
				"createdAt", "updatedAt"
			)
			select scheduled."remoteId", scheduled."archiveUrlIdentity", 0,
				scheduled."availableAt", now(), now()
			from scheduled
			on conflict ("archiveUrlIdentity") do update set
				"objectRemoteId" = excluded."objectRemoteId",
				priority = excluded.priority,
				"availableAt" = excluded."availableAt",
				"updatedAt" = now()
		`);
	}

	async down(_queryRunner: QueryRunner): Promise<void> {
		// Scheduling evidence is durable and is intentionally not deleted on rollback.
	}
}
