import type { MigrationInterface, QueryRunner } from 'typeorm';

// Apply explicitly after compatible readers are deployed. Never register this
// in blanket startup or reinterpret the published retirement migration.
export class FullHistoryDerivedOutputNamespaceMigration1795146600000 implements MigrationInterface {
	name = 'FullHistoryDerivedOutputNamespaceMigration1795146600000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await transactionBounds(queryRunner);
		await queryRunner.query(`
			alter table full_history_lcm_derived_output_retirement
				add column namespace_removed_at timestamptz,
				add column namespace_intent_sha256 bytea,
				add constraint chk_full_history_namespace_retirement check (
					(namespace_removed_at is null and namespace_intent_sha256 is null)
					or (namespace_removed_at is not null and namespace_intent_sha256 is not null
						and namespace_removed_at >= retired_at and octet_length(namespace_intent_sha256)=32)
				) not valid;
			create or replace function validate_full_history_derived_retirement()
			returns trigger language plpgsql as $$
			declare
				namespace_changed boolean;
				physical_changed boolean;
			begin
				if tg_op='DELETE' then raise exception 'retirement provenance is immutable'; end if;
				if tg_op='UPDATE' then
					if (to_jsonb(new)-'removal_confirmed_at'-'namespace_removed_at'-'namespace_intent_sha256')
						<> (to_jsonb(old)-'removal_confirmed_at'-'namespace_removed_at'-'namespace_intent_sha256') then
						raise exception 'retirement provenance is immutable';
					end if;
					namespace_changed := new.namespace_removed_at is distinct from old.namespace_removed_at
						or new.namespace_intent_sha256 is distinct from old.namespace_intent_sha256;
					physical_changed := new.removal_confirmed_at is distinct from old.removal_confirmed_at;
					if namespace_changed and physical_changed then
						raise exception 'record namespace removal before physical confirmation';
					end if;
					if not namespace_changed and not physical_changed then
						raise exception 'only a one-time retirement state transition is allowed';
					end if;
					if namespace_changed then
						if old.namespace_removed_at is not null or old.namespace_intent_sha256 is not null
							or old.removal_confirmed_at is not null
							or new.namespace_removed_at is null or new.namespace_intent_sha256 is null
							or new.namespace_removed_at < new.retired_at
							or octet_length(new.namespace_intent_sha256) <> 32 then
							raise exception 'only one exact namespace removal confirmation is allowed';
						end if;
					end if;
					if physical_changed then
						if old.removal_confirmed_at is not null or new.removal_confirmed_at is null then
							raise exception 'only one physical removal confirmation is allowed';
						end if;
						if new.namespace_removed_at is null
							or new.removal_confirmed_at < new.namespace_removed_at then
							raise exception 'namespace removal must precede physical confirmation';
						end if;
					end if;
					return new;
				end if;
				if new.removal_confirmed_at is not null or new.namespace_removed_at is not null
					or new.namespace_intent_sha256 is not null then
					raise exception 'public retirement must precede removal confirmations';
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
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await transactionBounds(queryRunner);
		// Preserve any namespace authority and require compatible consumers.
		// With no such markers, restore the original trigger contract exactly.
		await queryRunner.query(`
			lock table full_history_lcm_derived_output_retirement in access exclusive mode;
			do $$ begin
				if exists(select 1 from full_history_lcm_derived_output_retirement
					where namespace_removed_at is not null or namespace_intent_sha256 is not null) then
					raise exception 'cannot remove nonempty namespace recovery authority';
				end if;
			end $$;
			create or replace function validate_full_history_derived_retirement()
			returns trigger language plpgsql as $$
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
			alter table full_history_lcm_derived_output_retirement
				drop constraint chk_full_history_namespace_retirement,
				drop column namespace_intent_sha256,
				drop column namespace_removed_at;
		`);
	}
}

async function transactionBounds(queryRunner: QueryRunner): Promise<void> {
	if (!queryRunner.isTransactionActive) {
		throw new Error('Namespace recovery migration requires an active transaction');
	}
	await queryRunner.query("SET LOCAL lock_timeout='2s'");
	await queryRunner.query("SET LOCAL statement_timeout='30s'");
}
