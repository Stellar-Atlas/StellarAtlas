import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectEventSummaryMigration1785000000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveObjectEventSummaryMigration1785000000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(createSummaryTableSql);
		await queryRunner.query(createAdjustmentFunctionSql);
		await queryRunner.query(createRowTriggerFunctionSql);
		await queryRunner.query(createTruncateFunctionSql);

		await queryRunner.startTransaction();
		let cutoff = 0;
		try {
			await queryRunner.query(
				'lock table history_archive_object_event in share row exclusive mode'
			);
			await queryRunner.query('truncate history_archive_object_event_summary');
			cutoff = readCutoff(
				await queryRunner.query(
					'select coalesce(max(id), 0)::bigint as cutoff from history_archive_object_event'
				)
			);
			await queryRunner.query(
				'drop trigger if exists "trg_history_archive_object_event_summary" on history_archive_object_event'
			);
			await queryRunner.query(`
				create trigger "trg_history_archive_object_event_summary"
				after insert or delete or update of
					"archiveUrlIdentity", "objectType", "eventType", "evidenceClass"
				on history_archive_object_event
				for each row execute function refresh_history_archive_object_event_summary()
			`);
			await queryRunner.query(
				'drop trigger if exists "trg_history_archive_object_event_summary_truncate" on history_archive_object_event'
			);
			await queryRunner.query(`
				create trigger "trg_history_archive_object_event_summary_truncate"
				after truncate on history_archive_object_event
				for each statement execute function reset_history_archive_object_event_summary()
			`);
			await queryRunner.commitTransaction();
		} catch (error) {
			if (queryRunner.isTransactionActive) {
				await queryRunner.rollbackTransaction();
			}
			throw error;
		}

		await queryRunner.query(backfillSql, [cutoff]);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop trigger if exists "trg_history_archive_object_event_summary_truncate" on history_archive_object_event'
		);
		await queryRunner.query(
			'drop trigger if exists "trg_history_archive_object_event_summary" on history_archive_object_event'
		);
		await queryRunner.query(
			'drop function if exists reset_history_archive_object_event_summary()'
		);
		await queryRunner.query(
			'drop function if exists refresh_history_archive_object_event_summary()'
		);
		await queryRunner.query(
			'drop function if exists adjust_history_archive_object_event_summary(text, text, text, text, bigint)'
		);
		await queryRunner.query(
			'drop table if exists history_archive_object_event_summary'
		);
	}
}

const createSummaryTableSql = `
	create table if not exists history_archive_object_event_summary (
		"archiveUrlIdentity" text not null,
		"objectType" text not null,
		"eventType" text not null,
		"evidenceClass" text not null,
		"eventCount" bigint not null,
		"updatedAt" timestamptz not null default now(),
		constraint "PK_history_archive_object_event_summary" primary key (
			"archiveUrlIdentity", "objectType", "eventType", "evidenceClass"
		),
		constraint "CHK_history_archive_object_event_summary_count"
			check ("eventCount" >= 0)
	)
`;

const createAdjustmentFunctionSql = `
	create or replace function adjust_history_archive_object_event_summary(
		archive_identity text,
		object_type text,
		event_type text,
		evidence_class text,
		delta bigint
	) returns void as $$
	begin
		if delta < 0 then
			update history_archive_object_event_summary set
				"eventCount" = "eventCount" + delta,
				"updatedAt" = now()
			where "archiveUrlIdentity" = archive_identity
				and "objectType" = object_type
				and "eventType" = event_type
				and "evidenceClass" = coalesce(evidence_class, '');
		else
			insert into history_archive_object_event_summary (
				"archiveUrlIdentity", "objectType", "eventType", "evidenceClass",
				"eventCount", "updatedAt"
			) values (
				archive_identity, object_type, event_type,
				coalesce(evidence_class, ''), delta, now()
			)
			on conflict (
				"archiveUrlIdentity", "objectType", "eventType", "evidenceClass"
			)
			do update set
				"eventCount" = history_archive_object_event_summary."eventCount"
					+ excluded."eventCount",
				"updatedAt" = now();
		end if;
		delete from history_archive_object_event_summary
		where "archiveUrlIdentity" = archive_identity
			and "objectType" = object_type
			and "eventType" = event_type
			and "evidenceClass" = coalesce(evidence_class, '')
			and "eventCount" = 0;
	end;
	$$ language plpgsql
`;

const createRowTriggerFunctionSql = `
	create or replace function refresh_history_archive_object_event_summary()
	returns trigger as $$
	begin
		if tg_op = 'DELETE' or tg_op = 'UPDATE' then
			perform adjust_history_archive_object_event_summary(
				old."archiveUrlIdentity", old."objectType", old."eventType",
				old."evidenceClass", -1
			);
		end if;
		if tg_op = 'INSERT' or tg_op = 'UPDATE' then
			perform adjust_history_archive_object_event_summary(
				new."archiveUrlIdentity", new."objectType", new."eventType",
				new."evidenceClass", 1
			);
		end if;
		if tg_op = 'DELETE' then
			return old;
		end if;
		return new;
	end;
	$$ language plpgsql
`;

const createTruncateFunctionSql = `
	create or replace function reset_history_archive_object_event_summary()
	returns trigger as $$
	begin
		truncate history_archive_object_event_summary;
		return null;
	end;
	$$ language plpgsql
`;

const backfillSql = `
	insert into history_archive_object_event_summary (
		"archiveUrlIdentity", "objectType", "eventType", "evidenceClass",
		"eventCount", "updatedAt"
	)
	select
		"archiveUrlIdentity", "objectType", "eventType",
		coalesce("evidenceClass", ''), count(*)::bigint, now()
	from history_archive_object_event
	where id <= $1::bigint
	group by "archiveUrlIdentity", "objectType", "eventType",
		coalesce("evidenceClass", '')
	on conflict ("archiveUrlIdentity", "objectType", "eventType", "evidenceClass")
	do update set
		"eventCount" = history_archive_object_event_summary."eventCount"
			+ excluded."eventCount",
		"updatedAt" = now()
`;

function readCutoff(value: unknown): number {
	if (!Array.isArray(value)) {
		throw new Error('History archive event cutoff did not return rows');
	}
	const values: unknown[] = value;
	const row = values[0];
	if (typeof row !== 'object' || row === null || !('cutoff' in row)) {
		throw new Error('History archive event cutoff row is invalid');
	}
	const raw = row.cutoff;
	const cutoff = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isSafeInteger(cutoff) || cutoff < 0) {
		throw new Error('History archive event cutoff is invalid');
	}
	return cutoff;
}
