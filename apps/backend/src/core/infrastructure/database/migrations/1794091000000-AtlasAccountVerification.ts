import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AtlasAccountVerification1794091000000 implements MigrationInterface {
	readonly name = 'AtlasAccountVerification1794091000000';
	async up(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error('Verification migration requires a transaction');
		await runner.query("SET LOCAL lock_timeout = '2s'");
		await runner.query("SET LOCAL statement_timeout = '30s'");
		await runner.query(`CREATE TABLE atlas_verification_application (
			id uuid PRIMARY KEY,
			applicant_id text NOT NULL CHECK (length(applicant_id) BETWEEN 1 AND 200),
			network text NOT NULL CHECK (network IN ('mainnet','testnet')),
			address text NOT NULL CHECK (address ~ '^G[A-Z2-7]{55}$'),
			state text NOT NULL CHECK (state IN ('pending','changes_requested','approved','rejected','revoked')),
			revision integer NOT NULL CHECK (revision >= 1),
			created_at timestamptz NOT NULL,
			payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text) <= 32768),
			UNIQUE (applicant_id, network, address),
			CHECK ((payload->>'id') IS NOT NULL AND payload->>'id'=id::text),
			CHECK ((payload->>'applicantId') IS NOT NULL AND payload->>'applicantId'=applicant_id),
			CHECK ((payload->>'network') IS NOT NULL AND payload->>'network'=network),
			CHECK ((payload->>'address') IS NOT NULL AND payload->>'address'=address),
			CHECK ((payload->>'state') IS NOT NULL AND payload->>'state'=state),
			CHECK ((payload->>'revision') IS NOT NULL AND payload->>'revision'=revision::text)
		);
		CREATE UNIQUE INDEX atlas_verification_one_approved ON atlas_verification_application (network,address) WHERE state='approved';
		CREATE INDEX atlas_verification_queue ON atlas_verification_application (id) WHERE state='pending';
		CREATE INDEX atlas_verification_applicant_time ON atlas_verification_application (applicant_id,created_at);
		CREATE TABLE atlas_verification_event (
			application_id uuid NOT NULL REFERENCES atlas_verification_application(id),
			revision integer NOT NULL CHECK (revision >= 1),
			event jsonb NOT NULL CHECK (jsonb_typeof(event)='object' AND octet_length(event::text) <= 36864),
			PRIMARY KEY (application_id,revision)
		)`);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query('DROP TABLE atlas_verification_event');
		await runner.query('DROP TABLE atlas_verification_application');
	}
}
