import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectQueueMigration1784350000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectQueueMigration1784350000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_object_queue" (
				"id" serial not null,
				"remoteId" uuid not null default gen_random_uuid(),
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"hostIdentity" text not null,
				"objectType" text not null,
				"objectKey" text not null,
				"objectOrder" integer not null,
				"objectUrl" text not null,
				"status" text not null default 'pending',
				"workerStage" text,
				"checkpointLedger" integer,
				"bucketHash" text,
				"bytesDownloaded" bigint,
				"attempts" integer not null default 0,
				"claimedAt" timestamptz,
				"claimedByCommunityScannerId" uuid,
				"errorType" text,
				"errorMessage" text,
				"httpStatus" integer,
				"verifiedAt" timestamptz,
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_queue"
					primary key ("id"),
				constraint "UQ_history_archive_object_queue_remote"
					unique ("remoteId"),
				constraint "UQ_history_archive_object_queue_identity"
					unique ("archiveUrlIdentity", "objectType", "objectKey"),
				constraint "CHK_history_archive_object_queue_type"
					check ("objectType" in (
						'history-archive-state',
						'checkpoint-state',
						'ledger',
						'transactions',
						'results',
						'bucket'
					)),
				constraint "CHK_history_archive_object_queue_status"
					check ("status" in (
						'pending',
						'scanning',
						'verified',
						'failed'
					))
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_status"
			on "history_archive_object_queue" (
				"status",
				"objectOrder",
				"objectKey",
				"archiveUrlIdentity"
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_archive"
			on "history_archive_object_queue" ("archiveUrlIdentity", "status")
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_host"
			on "history_archive_object_queue" ("hostIdentity", "status")
		`);
		await queryRunner.query(`
			create unique index if not exists "idx_history_archive_object_remote"
			on "history_archive_object_queue" ("remoteId")
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_key"
			on "history_archive_object_queue" ("objectType", "objectKey")
		`);
		await this.backfillFromHistoryArchiveStates(queryRunner);
		await this.backfillFromBucketEvidence(queryRunner);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_object_queue"
		`);
	}

	private async backfillFromHistoryArchiveStates(
		queryRunner: QueryRunner
	): Promise<void> {
		await queryRunner.query(`
			with available_state as (
				select
					"archiveUrl",
					"archiveUrlIdentity",
					"stateUrl",
					"currentLedger",
					"currentBuckets",
					"hotArchiveBuckets",
					"observedAt",
					case
						when "currentLedger" < 63 then 63
						else ((("currentLedger" + 1) / 64)::integer * 64) - 1
					end as checkpoint
				from "history_archive_state_snapshot"
				where status = 'available'
					and "rawState" is not null
					and "currentLedger" is not null
			),
			state_objects as (
				select
					"archiveUrl",
					"archiveUrlIdentity",
					'history-archive-state' as "objectType",
					'root' as "objectKey",
					0 as "objectOrder",
					"stateUrl" as "objectUrl",
					null::integer as "checkpointLedger",
					null::text as "bucketHash",
					"observedAt"
				from available_state
			),
			checkpoint_objects as (
				select
					state."archiveUrl",
					state."archiveUrlIdentity",
					object_type."objectType",
					object_type."objectType" || ':' || checkpoint_hex.hex as "objectKey",
					object_type."objectOrder",
					state."archiveUrl" || '/' || object_type.category || '/'
						|| substring(checkpoint_hex.hex from 1 for 2) || '/'
						|| substring(checkpoint_hex.hex from 3 for 2) || '/'
						|| substring(checkpoint_hex.hex from 5 for 2) || '/'
						|| object_type.category || '-' || checkpoint_hex.hex
						|| object_type.extension as "objectUrl",
					state.checkpoint as "checkpointLedger",
					null::text as "bucketHash",
					state."observedAt"
				from available_state state
				cross join lateral (
					select lpad(to_hex(state.checkpoint), 8, '0') as hex
				) checkpoint_hex
				cross join (
					values
						('checkpoint-state', 'history', '.json', 10),
						('ledger', 'ledger', '.xdr.gz', 20),
						('transactions', 'transactions', '.xdr.gz', 30),
						('results', 'results', '.xdr.gz', 40)
				) as object_type(
					"objectType",
					category,
					extension,
					"objectOrder"
				)
			),
			bucket_hashes as (
				select distinct
					state."archiveUrl",
					state."archiveUrlIdentity",
					lower(hash.value) as "bucketHash",
					state."observedAt"
				from available_state state
				cross join lateral jsonb_array_elements(
					coalesce(state."currentBuckets", '[]'::jsonb)
					|| coalesce(state."hotArchiveBuckets", '[]'::jsonb)
				) bucket
				cross join lateral (
					values
						(bucket->>'curr'),
						(bucket->>'snap'),
						(bucket->'next'->>'output')
				) hash(value)
				where hash.value is not null
					and lower(hash.value) ~ '^[0-9a-f]{64}$'
					and lower(hash.value) !~ '^0+$'
			),
			bucket_objects as (
				select
					"archiveUrl",
					"archiveUrlIdentity",
					'bucket' as "objectType",
					'bucket:' || "bucketHash" as "objectKey",
					50 as "objectOrder",
					"archiveUrl" || '/bucket/'
						|| substring("bucketHash" from 1 for 2) || '/'
						|| substring("bucketHash" from 3 for 2) || '/'
						|| substring("bucketHash" from 5 for 2) || '/'
						|| 'bucket-' || "bucketHash" || '.xdr.gz' as "objectUrl",
					null::integer as "checkpointLedger",
					"bucketHash",
					"observedAt"
				from bucket_hashes
			)
			insert into "history_archive_object_queue" (
				"archiveUrl",
				"archiveUrlIdentity",
				"hostIdentity",
				"remoteId",
				"objectType",
				"objectKey",
				"objectOrder",
				"objectUrl",
				"status",
				"workerStage",
				"checkpointLedger",
				"bucketHash",
				"createdAt",
				"updatedAt"
			)
			select
				"archiveUrl",
				"archiveUrlIdentity",
				lower(
					split_part(
						regexp_replace("archiveUrl", '^https?://', '', 'i'),
						'/',
						1
					)
				),
				gen_random_uuid(),
				"objectType",
				"objectKey",
				"objectOrder",
				"objectUrl",
				'pending',
				null,
				"checkpointLedger",
				"bucketHash",
				"observedAt",
				now()
			from (
				select * from state_objects
				union all
				select * from checkpoint_objects
				union all
				select * from bucket_objects
			) objects
			on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do nothing
		`);
	}

	private async backfillFromBucketEvidence(
		queryRunner: QueryRunner
	): Promise<void> {
		await queryRunner.query(`
			insert into "history_archive_object_queue" (
				"archiveUrl",
				"archiveUrlIdentity",
				"hostIdentity",
				"remoteId",
				"objectType",
				"objectKey",
				"objectOrder",
				"objectUrl",
				"status",
				"workerStage",
				"bucketHash",
				"verifiedAt",
				"createdAt",
				"updatedAt"
			)
			select distinct on (
				lower(regexp_replace(evidence."archiveUrl", '/+$', '')),
				lower(evidence."bucketHash")
			)
				regexp_replace(evidence."archiveUrl", '/+$', ''),
				lower(regexp_replace(evidence."archiveUrl", '/+$', '')),
				lower(
					split_part(
						regexp_replace(evidence."archiveUrl", '^https?://', '', 'i'),
						'/',
						1
					)
				),
				gen_random_uuid(),
				'bucket',
				'bucket:' || lower(evidence."bucketHash"),
				50,
				evidence."bucketUrl",
				'verified',
				null,
				lower(evidence."bucketHash"),
				evidence."observedAt",
				evidence."observedAt",
				now()
			from "history_archive_scan_evidence" evidence
			where evidence.kind = 'bucket'
				and evidence.status = 'verified'
				and lower(evidence."bucketHash") ~ '^[0-9a-f]{64}$'
			order by
				lower(regexp_replace(evidence."archiveUrl", '/+$', '')),
				lower(evidence."bucketHash"),
				evidence."observedAt" desc
			on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do update set
				"objectUrl" = excluded."objectUrl",
				"status" = 'verified',
				"bucketHash" = excluded."bucketHash",
				"verifiedAt" = excluded."verifiedAt",
				"updatedAt" = now()
		`);
	}
}
