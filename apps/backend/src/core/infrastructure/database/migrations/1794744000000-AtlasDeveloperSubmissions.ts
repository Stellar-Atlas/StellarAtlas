import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AtlasDeveloperSubmissions1794744000000 implements MigrationInterface {
	async up(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error('Developer submission migration requires a transaction');
		await runner.query("SET LOCAL lock_timeout='2s'");
		await runner.query("SET LOCAL statement_timeout='30s'");
		await runner.query(`
			CREATE TABLE atlas_developer_submission (
				id uuid PRIMARY KEY,
				user_id text NOT NULL REFERENCES atlas_developer_github_principal(user_id),
				idempotency_key uuid NOT NULL,
				network_passphrase text NOT NULL CHECK (octet_length(network_passphrase) BETWEEN 1 AND 256),
				request jsonb NOT NULL CHECK (jsonb_typeof(request)='object' AND octet_length(request::text)<=2048),
				status text NOT NULL CHECK (status IN ('checking','completed','unavailable')),
				result jsonb CHECK (jsonb_typeof(result)='object' AND octet_length(result::text)<=16384),
				created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
				expires_at timestamptz NOT NULL,
				CHECK (expires_at>created_at),
				CHECK ((status='checking' AND result IS NULL) OR (status<>'checking' AND result IS NOT NULL)),
				UNIQUE (user_id,idempotency_key)
			);
			CREATE INDEX atlas_developer_submission_expiry ON atlas_developer_submission(expires_at);
			CREATE INDEX atlas_developer_submission_created ON atlas_developer_submission(created_at);
			CREATE INDEX atlas_developer_submission_owner_created ON atlas_developer_submission(user_id,created_at);
		`);
	}

	async down(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error('Developer submission migration requires a transaction');
		await runner.query("SET LOCAL lock_timeout='2s'");
		await runner.query("SET LOCAL statement_timeout='30s'");
		await runner.query('DROP TABLE atlas_developer_submission');
	}
}
