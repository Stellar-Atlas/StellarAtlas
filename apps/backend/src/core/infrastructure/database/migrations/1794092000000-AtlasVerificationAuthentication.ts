import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AtlasVerificationAuthentication1794092000000 implements MigrationInterface {
	readonly name = 'AtlasVerificationAuthentication1794092000000';
	async up(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error(
				'Verification authentication migration requires a transaction'
			);
		await runner.query("SET LOCAL lock_timeout='2s'");
		await runner.query("SET LOCAL statement_timeout='30s'");
		await runner.query(`CREATE TABLE atlas_verification_challenge (
			hash text PRIMARY KEY CHECK(hash~'^[0-9a-f]{64}$'),
			network text NOT NULL CHECK(network IN('mainnet','testnet')),
			address text NOT NULL CHECK(address~'^G[A-Z2-7]{55}$'),
			created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL
		);
		CREATE INDEX atlas_verification_challenge_expiry ON atlas_verification_challenge(expires_at);
		CREATE TABLE atlas_verification_auth (
			hash text PRIMARY KEY CHECK(hash~'^[0-9a-f]{64}$'),
			network text NOT NULL CHECK(network IN('mainnet','testnet')),
			address text NOT NULL CHECK(address~'^G[A-Z2-7]{55}$'),
			expires_at timestamptz NOT NULL, proof_expires_at timestamptz NOT NULL,
			token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[0-9a-f]{64}$'),
			payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
			CHECK(payload->>'hash' IS NOT NULL AND payload->>'hash'=hash),
			CHECK(payload->>'network' IS NOT NULL AND payload->>'network'=network),
			CHECK(payload->>'address' IS NOT NULL AND payload->>'address'=address)
		);
		CREATE INDEX atlas_verification_auth_expiry ON atlas_verification_auth(proof_expires_at);
		CREATE TABLE atlas_verification_auth_budget (
			id text PRIMARY KEY CHECK(id='authority'),window_start timestamptz NOT NULL,
			count integer NOT NULL CHECK(count BETWEEN 1 AND 7)
		)`);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query('DROP TABLE atlas_verification_auth_budget');
		await runner.query('DROP TABLE atlas_verification_auth');
		await runner.query('DROP TABLE atlas_verification_challenge');
	}
}
