import type { MigrationInterface, QueryRunner } from 'typeorm';

const proofTable = 'history_archive_checkpoint_proof';
const attestationTable = 'history_archive_checkpoint_proof_attestation';
const durableCheckpointTable =
	'history_archive_checkpoint_proof_attested_checkpoint';
const durableRollupTable =
	'history_archive_checkpoint_proof_attestation_rollup';
const recordFunction = 'record_history_archive_checkpoint_proof_attestation';
const captureFunction = 'capture_history_archive_checkpoint_proof_attestation';
const captureTrigger = 'history_archive_checkpoint_proof_attestation_capture';
const captureUpdateTrigger =
	'history_archive_checkpoint_proof_attestation_capture_update';
const attestationRollupFunction =
	'record_history_archive_checkpoint_proof_attested_checkpoint';
const attestationRollupTrigger =
	'history_archive_checkpoint_proof_attestation_rollup_insert';

export const historyArchiveCheckpointProofStatementAttestationUpSql = `
        drop trigger if exists "${captureTrigger}" on "${proofTable}";
        drop trigger if exists "${captureUpdateTrigger}" on "${proofTable}";
        drop trigger if exists "${attestationRollupTrigger}"
                on "${attestationTable}";

        create or replace function "${captureFunction}"()
        returns trigger
        language plpgsql
        as $$
        begin
                insert into "${attestationTable}" (
                        "proofId",
                        "archiveUrl",
                        "archiveUrlIdentity",
                        "checkpointLedger",
                        status,
                        "proofVersion",
                        "evaluatedAt",
                        "proofSnapshot"
                )
                select
                        proof.id,
                        proof."archiveUrl",
                        proof."archiveUrlIdentity",
                        proof."checkpointLedger",
                        proof.status,
                        proof."proofVersion",
                        proof."evaluatedAt",
                        to_jsonb(proof)
                from new_proofs proof
                where proof.status <> 'pending'
                on conflict do nothing;
                return null;
        end
        $$;

        create or replace function "${attestationRollupFunction}"()
        returns trigger
        language plpgsql
        as $$
        begin
                with inserted_checkpoints as materialized (
                        insert into "${durableCheckpointTable}" (
                                "archiveUrlIdentity",
                                "checkpointLedger"
                        )
                        select distinct
                                attestation."archiveUrlIdentity",
                                attestation."checkpointLedger"
                        from new_attestations attestation
                        where attestation.status = 'verified'
                        on conflict do nothing
                        returning "archiveUrlIdentity"
                ), grouped as (
                        select
                                "archiveUrlIdentity",
                                count(*)::bigint as inserted_count
                        from inserted_checkpoints
                        group by "archiveUrlIdentity"
                )
                insert into "${durableRollupTable}" (
                        "archiveUrlIdentity",
                        "durableVerifiedCheckpointProofs"
                )
                select "archiveUrlIdentity", inserted_count
                from grouped
                on conflict ("archiveUrlIdentity") do update set
                        "durableVerifiedCheckpointProofs" =
                                "${durableRollupTable}".
                                        "durableVerifiedCheckpointProofs"
                                + excluded."durableVerifiedCheckpointProofs";
                return null;
        end
        $$;

        create trigger "${captureTrigger}"
        after insert on "${proofTable}"
        referencing new table as new_proofs
        for each statement execute function "${captureFunction}"();

        create trigger "${captureUpdateTrigger}"
        after update on "${proofTable}"
        referencing new table as new_proofs
        for each statement execute function "${captureFunction}"();

        create trigger "${attestationRollupTrigger}"
        after insert on "${attestationTable}"
        referencing new table as new_attestations
        for each statement execute function "${attestationRollupFunction}"();
`;

export const historyArchiveCheckpointProofStatementAttestationDownSql = `
        drop trigger if exists "${captureTrigger}" on "${proofTable}";
        drop trigger if exists "${captureUpdateTrigger}" on "${proofTable}";
        drop trigger if exists "${attestationRollupTrigger}"
                on "${attestationTable}";

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
        $$;

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
                                        "${durableRollupTable}".
                                                "durableVerifiedCheckpointProofs"
                                        + 1;
                end if;
                return new;
        end
        $$;

        create trigger "${captureTrigger}"
        after insert or update on "${proofTable}"
        for each row execute function "${captureFunction}"();

        create trigger "${attestationRollupTrigger}"
        after insert on "${attestationTable}"
        for each row execute function "${attestationRollupFunction}"();
`;

export class HistoryArchiveCheckpointProofStatementAttestationMigration1788587936000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofStatementAttestationMigration1788587936000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '5s'`);
		await queryRunner.query(`set local statement_timeout = '30s'`);
		await queryRunner.query(
			historyArchiveCheckpointProofStatementAttestationUpSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '5s'`);
		await queryRunner.query(`set local statement_timeout = '30s'`);
		await queryRunner.query(
			historyArchiveCheckpointProofStatementAttestationDownSql
		);
	}
}
