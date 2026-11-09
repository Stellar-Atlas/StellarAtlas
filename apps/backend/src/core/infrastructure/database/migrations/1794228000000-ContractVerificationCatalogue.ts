import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContractVerificationCatalogue1794228000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE contract_verification_catalogue (
				network_key varchar(64) COLLATE "C" NOT NULL,
				contract_id varchar(56) COLLATE "C" NOT NULL,
				repository_key varchar(140) COLLATE "C" NOT NULL,
				observed_ledger bigint NOT NULL CHECK (observed_ledger BETWEEN 1 AND 4294967295),
				instance_modified_ledger bigint CHECK (instance_modified_ledger BETWEEN 1 AND observed_ledger),
				checked_at timestamptz NOT NULL,
				wasm_sha256 varchar(64) NOT NULL CHECK (wasm_sha256 ~ '^[a-f0-9]{64}$'),
				build_record jsonb NOT NULL CHECK (
					jsonb_typeof(build_record) = 'object' AND octet_length(build_record::text) <= 4608
				),
				PRIMARY KEY (network_key, contract_id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX contract_verification_catalogue_repository_idx
			ON contract_verification_catalogue (network_key, repository_key, contract_id)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE contract_verification_catalogue');
	}
}
