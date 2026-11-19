import type { MigrationInterface, QueryRunner } from 'typeorm';

// Deliberately not registered in the blanket startup runner. Apply only with
// the coordinated download, recovery and residency consumers deployed.
export class FullHistoryDerivedOutputRetirementMigration1795125600000 implements MigrationInterface {
	name = 'FullHistoryDerivedOutputRetirementMigration1795125600000';
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table full_history_lcm_derived_output_retirement (
				batch_id uuid not null, dataset varchar(64) not null,
				output_sha256 bytea not null, canonical_sha256 bytea not null,
				manifest_sha256 bytea not null, evidence_sha256 bytea not null,
				transform_revision varchar(40) not null,
				retired_at timestamptz not null default now(),
				removal_confirmed_at timestamptz,
				primary key(batch_id,dataset),
				foreign key(batch_id,dataset) references full_history_ledger_close_meta_dataset(batch_id,dataset) on delete restrict,
				check(dataset in ('transactions','transaction-results','operations')),
				check(octet_length(output_sha256)=32 and octet_length(canonical_sha256)=32
					and octet_length(manifest_sha256)=32 and octet_length(evidence_sha256)=32),
				check(transform_revision ~ '^[0-9a-f]{40}$'),
				check(removal_confirmed_at is null or removal_confirmed_at >= retired_at)
			);
			create function validate_full_history_derived_retirement() returns trigger language plpgsql as $$
			begin
				if tg_op='DELETE' then raise exception 'retirement provenance is immutable'; end if;
				if tg_op='UPDATE' then
					if (to_jsonb(new)-'removal_confirmed_at') <> (to_jsonb(old)-'removal_confirmed_at')
						or old.removal_confirmed_at is not null or new.removal_confirmed_at is null then
						raise exception 'only one physical removal confirmation is allowed';
					end if;
					return new;
				end if;
				if new.removal_confirmed_at is not null then
					raise exception 'public retirement must precede physical removal confirmation';
				end if;
				if not exists (
					select 1 from full_history_ledger_close_meta_dataset d
					join full_history_ledger_close_meta_dataset c on c.batch_id=d.batch_id and c.dataset='ledger-close-meta'
					join full_history_ledger_close_meta_batch b on b.id=d.batch_id
					where d.batch_id=new.batch_id and d.dataset=new.dataset
					and d.representation='typed-projection' and c.representation='lossless-replay'
					and d.output_sha256=new.output_sha256 and c.output_sha256=new.canonical_sha256
					and b.processing_manifest_sha256=new.manifest_sha256
				) then raise exception 'retirement must bind original output, manifest and canonical replay'; end if;
				return new;
			end $$;
			create trigger validate_full_history_derived_retirement
				before insert or update or delete on full_history_lcm_derived_output_retirement
				for each row execute function validate_full_history_derived_retirement()
		`);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		// Do not erase authority for already missing files during rollback.
		await queryRunner.query(`do $$ begin
			if exists(select 1 from full_history_lcm_derived_output_retirement) then
				raise exception 'cannot remove nonempty retirement authority';
			end if;
		end $$;
		drop table full_history_lcm_derived_output_retirement;
		drop function validate_full_history_derived_retirement()`);
	}
}
