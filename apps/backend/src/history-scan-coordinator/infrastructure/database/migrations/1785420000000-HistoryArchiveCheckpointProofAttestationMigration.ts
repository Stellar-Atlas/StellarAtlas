import type { MigrationInterface, QueryRunner } from 'typeorm';

const attestationTable = 'history_archive_checkpoint_proof_attestation';
const invalidationTable =
	'history_archive_checkpoint_proof_attestation_invalidation';
const durableRollupTable =
	'history_archive_checkpoint_proof_attestation_rollup';
const durableCheckpointTable =
	'history_archive_checkpoint_proof_attested_checkpoint';
const validProofView = 'history_archive_verified_checkpoint_proof_attestation';
const recordFunction = 'record_history_archive_checkpoint_proof_attestation';
const captureFunction = 'capture_history_archive_checkpoint_proof_attestation';
const captureTrigger = 'history_archive_checkpoint_proof_attestation_capture';
const rejectMutationFunction = 'reject_history_archive_proof_event_mutation';
const attestationAppendOnlyTrigger =
	'history_archive_checkpoint_proof_attestation_append_only';
const invalidationAppendOnlyTrigger =
	'history_archive_checkpoint_proof_invalidation_append_only';
const attestationRollupFunction =
	'record_history_archive_checkpoint_proof_attested_checkpoint';
const invalidationRollupFunction =
	'invalidate_history_archive_checkpoint_proof_attested_checkpoint';
const attestationRollupTrigger =
	'history_archive_checkpoint_proof_attestation_rollup_insert';
const invalidationRollupTrigger =
	'history_archive_checkpoint_proof_invalidation_rollup_insert';

export class HistoryArchiveCheckpointProofAttestationMigration1785420000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofAttestationMigration1785420000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`set local statement_timeout = '5min'`);
		await queryRunner.query(`
			create table if not exists "${attestationTable}" (
				id bigserial primary key,
				"proofId" bigint not null,
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"checkpointLedger" bigint not null,
				status text not null,
				"proofVersion" smallint not null,
				"evaluatedAt" timestamptz not null,
				"proofSnapshot" jsonb not null,
				"capturedAt" timestamptz not null default now(),
				constraint "history_archive_checkpoint_proof_attestation_version_check"
					check ("proofVersion" > 0),
				constraint "history_archive_checkpoint_proof_attestation_status_check"
					check (status in ('verified', 'mismatch', 'not-evaluable'))
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"history_archive_checkpoint_proof_attestation_source_checkpoint_idx"
			on "${attestationTable}" (
				"archiveUrlIdentity",
				"checkpointLedger"
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"history_archive_checkpoint_proof_attestation_status_source_idx"
			on "${attestationTable}" (
				status,
				"archiveUrlIdentity",
				"checkpointLedger",
				"evaluatedAt" desc
			)
		`);
		await queryRunner.query(`
			create unique index if not exists
				"history_archive_checkpoint_proof_attestation_snapshot_key"
			on "${attestationTable}" (
				"proofId",
				"proofVersion",
				"evaluatedAt",
				status,
				md5("proofSnapshot"::text)
			)
		`);
		await queryRunner.query(`
			create table if not exists "${invalidationTable}" (
				id bigserial primary key,
				"attestationId" bigint not null references "${attestationTable}"(id),
				reason text not null,
				evidence jsonb not null,
				"invalidatedAt" timestamptz not null default now(),
				constraint "history_archive_checkpoint_proof_attestation_invalidation_key"
					unique ("attestationId")
			)
		`);
		await queryRunner.query(`
			create table if not exists "${durableCheckpointTable}" (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" bigint not null,
				primary key ("archiveUrlIdentity", "checkpointLedger")
			)
		`);
		await queryRunner.query(`
			create table if not exists "${durableRollupTable}" (
				"archiveUrlIdentity" text primary key,
				"durableVerifiedCheckpointProofs" bigint not null default 0,
				constraint "history_archive_checkpoint_proof_attestation_rollup_count_check"
					check ("durableVerifiedCheckpointProofs" >= 0)
			)
		`);
		await queryRunner.query(`
			create or replace function "${rejectMutationFunction}"()
			returns trigger
			language plpgsql
			as $$
			begin
				raise exception '% is append-only', tg_table_name;
			end
			$$
		`);
		await queryRunner.query(`
			create trigger "${attestationAppendOnlyTrigger}"
			before update or delete on "${attestationTable}"
			for each row execute function "${rejectMutationFunction}"()
		`);
		await queryRunner.query(`
			create trigger "${invalidationAppendOnlyTrigger}"
			before update or delete on "${invalidationTable}"
			for each row execute function "${rejectMutationFunction}"()
		`);
		await queryRunner.query(`
			create or replace function "${attestationRollupFunction}"()
			returns trigger
			language plpgsql
			as $$
			begin
				if new.status <> 'verified' then
					return new;
				end if;

				insert into "${durableCheckpointTable}" (
					"archiveUrlIdentity",
					"checkpointLedger"
				) values (
					new."archiveUrlIdentity",
					new."checkpointLedger"
				)
				on conflict do nothing;

				if found then
					insert into "${durableRollupTable}" (
						"archiveUrlIdentity",
						"durableVerifiedCheckpointProofs"
					) values (new."archiveUrlIdentity", 1)
					on conflict ("archiveUrlIdentity") do update set
						"durableVerifiedCheckpointProofs" =
							"${durableRollupTable}"."durableVerifiedCheckpointProofs" + 1;
				end if;

				return new;
			end
			$$
		`);
		await queryRunner.query(`
			create or replace function "${invalidationRollupFunction}"()
			returns trigger
			language plpgsql
			as $$
			declare
				invalidated "${attestationTable}"%rowtype;
			begin
				select * into invalidated
				from "${attestationTable}"
				where id = new."attestationId";

				if invalidated.status <> 'verified' then
					return new;
				end if;

				delete from "${durableCheckpointTable}" checkpoint
				where checkpoint."archiveUrlIdentity" =
					invalidated."archiveUrlIdentity"
				and checkpoint."checkpointLedger" =
					invalidated."checkpointLedger"
				and not exists (
					select 1
					from "${attestationTable}" candidate
					left join "${invalidationTable}" invalidation
						on invalidation."attestationId" = candidate.id
					where candidate."archiveUrlIdentity" =
						invalidated."archiveUrlIdentity"
						and candidate."checkpointLedger" =
							invalidated."checkpointLedger"
						and candidate.status = 'verified'
						and invalidation.id is null
				);

				if found then
					update "${durableRollupTable}"
					set "durableVerifiedCheckpointProofs" =
						greatest("durableVerifiedCheckpointProofs" - 1, 0)
					where "archiveUrlIdentity" = invalidated."archiveUrlIdentity";
				end if;

				return new;
			end
			$$
		`);
		await queryRunner.query(`
			create trigger "${attestationRollupTrigger}"
			after insert on "${attestationTable}"
			for each row execute function "${attestationRollupFunction}"()
		`);
		await queryRunner.query(`
			create trigger "${invalidationRollupTrigger}"
			after insert on "${invalidationTable}"
			for each row execute function "${invalidationRollupFunction}"()
		`);
		await queryRunner.query(`
			create or replace function "${recordFunction}"(
				proof history_archive_checkpoint_proof
			) returns void
			language plpgsql
			as $$
			declare
				proof_snapshot jsonb;
			begin
				if proof.status = 'pending' then
					return;
				end if;

				proof_snapshot := to_jsonb(proof);

				insert into "${attestationTable}" (
					"proofId",
					"archiveUrl",
					"archiveUrlIdentity",
					"checkpointLedger",
					status,
					"proofVersion",
					"evaluatedAt",
					"proofSnapshot"
				) values (
					proof.id,
					proof."archiveUrl",
					proof."archiveUrlIdentity",
					proof."checkpointLedger",
					proof.status,
					proof."proofVersion",
					proof."evaluatedAt",
					proof_snapshot
				)
				on conflict do nothing;
			end
			$$
		`);
		await queryRunner.query(`
			create or replace function "${captureFunction}"()
			returns trigger
			language plpgsql
			as $$
			begin
				if new.status <> 'pending' then
					perform "${recordFunction}"(new);
				end if;
				return new;
			end
			$$
		`);
		await queryRunner.query(`
			drop trigger if exists "${captureTrigger}"
			on history_archive_checkpoint_proof
		`);
		await queryRunner.query(`
			create trigger "${captureTrigger}"
			after insert or update on history_archive_checkpoint_proof
			for each row execute function "${captureFunction}"()
		`);
		await queryRunner.query(`
			lock table history_archive_checkpoint_proof
			in share row exclusive mode
		`);
		await queryRunner.query(`
			alter table "${attestationTable}"
			disable trigger "${attestationRollupTrigger}"
		`);
		await queryRunner.query(`
			select "${recordFunction}"(proof)
			from history_archive_checkpoint_proof proof
			where proof.status <> 'pending'
		`);
		await queryRunner.query(`
			insert into "${durableCheckpointTable}" (
				"archiveUrlIdentity",
				"checkpointLedger"
			)
			select distinct
				attestation."archiveUrlIdentity",
				attestation."checkpointLedger"
			from "${attestationTable}" attestation
			left join "${invalidationTable}" invalidation
				on invalidation."attestationId" = attestation.id
			where attestation.status = 'verified'
			and invalidation.id is null
			on conflict do nothing
		`);
		await queryRunner.query(`
			insert into "${durableRollupTable}" (
				"archiveUrlIdentity",
				"durableVerifiedCheckpointProofs"
			)
			select
				checkpoint."archiveUrlIdentity",
				count(*)::bigint
			from "${durableCheckpointTable}" checkpoint
			group by checkpoint."archiveUrlIdentity"
			on conflict ("archiveUrlIdentity") do update set
				"durableVerifiedCheckpointProofs" =
					excluded."durableVerifiedCheckpointProofs"
		`);
		await queryRunner.query(`
			alter table "${attestationTable}"
			enable trigger "${attestationRollupTrigger}"
		`);
		await queryRunner.query(`
			create or replace view "${validProofView}" as
			select distinct on (
				attestation."archiveUrlIdentity",
				attestation."checkpointLedger",
				attestation."proofVersion"
			) proof.*
			from "${attestationTable}" attestation
			cross join lateral jsonb_populate_record(
				null::history_archive_checkpoint_proof,
				attestation."proofSnapshot"
			) proof
			where attestation.status = 'verified'
			and not exists (
				select 1
				from "${invalidationTable}" invalidation
				where invalidation."attestationId" = attestation.id
			)
			order by
				attestation."archiveUrlIdentity",
				attestation."checkpointLedger",
				attestation."proofVersion",
				attestation."evaluatedAt" desc,
				attestation.id desc
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop view if exists "${validProofView}"`);
		await queryRunner.query(`
			drop trigger if exists "${invalidationRollupTrigger}"
			on "${invalidationTable}"
		`);
		await queryRunner.query(`
			drop trigger if exists "${attestationRollupTrigger}"
			on "${attestationTable}"
		`);
		await queryRunner.query(`
			drop trigger if exists "${invalidationAppendOnlyTrigger}"
			on "${invalidationTable}"
		`);
		await queryRunner.query(`
			drop trigger if exists "${attestationAppendOnlyTrigger}"
			on "${attestationTable}"
		`);
		await queryRunner.query(`
			drop trigger if exists "${captureTrigger}"
			on history_archive_checkpoint_proof
		`);
		await queryRunner.query(`drop function if exists "${captureFunction}"()`);
		await queryRunner.query(`
			drop function if exists "${recordFunction}"(
				history_archive_checkpoint_proof
			)
		`);
		await queryRunner.query(
			`drop function if exists "${rejectMutationFunction}"()`
		);
		await queryRunner.query(
			`drop function if exists "${invalidationRollupFunction}"()`
		);
		await queryRunner.query(
			`drop function if exists "${attestationRollupFunction}"()`
		);
		await queryRunner.query(`drop table if exists "${durableRollupTable}"`);
		await queryRunner.query(`drop table if exists "${durableCheckpointTable}"`);
		await queryRunner.query(`drop table if exists "${invalidationTable}"`);
		await queryRunner.query(`drop table if exists "${attestationTable}"`);
	}
}
