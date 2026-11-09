import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AtlasDeveloperAuthentication1794232800000 implements MigrationInterface {
	async up(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error(
				'Developer authentication migration requires a transaction'
			);
		await runner.query("SET LOCAL lock_timeout='2s'");
		await runner.query("SET LOCAL statement_timeout='30s'");
		await runner.query(`
			CREATE TABLE atlas_developer_github_flow (
				state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
				browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
				sealed_verifier text NOT NULL CHECK (sealed_verifier ~ '^[A-Za-z0-9_-]{95}$'),
				expires_at timestamptz NOT NULL
			);
			CREATE INDEX atlas_developer_github_flow_expiry ON atlas_developer_github_flow(expires_at);
			CREATE TABLE atlas_developer_github_budget (
				singleton boolean PRIMARY KEY CHECK (singleton),
				window_start timestamptz NOT NULL,
				starts integer NOT NULL CHECK (starts BETWEEN 1 AND 30)
			);
			CREATE TABLE atlas_developer_github_principal (
				user_id text PRIMARY KEY CHECK (user_id ~ '^[1-9][0-9]{0,15}$'),
				created_at timestamptz NOT NULL DEFAULT clock_timestamp()
			);
			CREATE TABLE atlas_developer_github_session (
				token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
				user_id text NOT NULL REFERENCES atlas_developer_github_principal(user_id),
				expires_at timestamptz NOT NULL
			);
			CREATE INDEX atlas_developer_github_session_expiry ON atlas_developer_github_session(expires_at);
			CREATE INDEX atlas_developer_github_session_user ON atlas_developer_github_session(user_id);
		`);
	}

	async down(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error(
				'Developer authentication migration requires a transaction'
			);
		await runner.query("SET LOCAL lock_timeout='2s'");
		await runner.query("SET LOCAL statement_timeout='30s'");
		await runner.query(`
			DROP TABLE atlas_developer_github_session, atlas_developer_github_principal,
				atlas_developer_github_budget, atlas_developer_github_flow
		`);
	}
}
