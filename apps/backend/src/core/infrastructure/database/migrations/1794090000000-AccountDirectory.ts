import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountDirectory1794090000000 implements MigrationInterface {
	readonly name = 'AccountDirectory1794090000000';

	async up(runner: QueryRunner): Promise<void> {
		if (!runner.isTransactionActive)
			throw new Error('Account directory migration requires a transaction');
		await runner.query("SET LOCAL lock_timeout = '2s'");
		await runner.query("SET LOCAL statement_timeout = '30s'");
		await runner.query(`
			CREATE TABLE expert_directory_checkpoint (
				source text PRIMARY KEY CHECK (source = 'stellar-expert/public-directory'),
				"commit" text NOT NULL CHECK ("commit" ~ '^[0-9a-f]{40}$'),
				observed_at text NOT NULL,
				previous_commit text CHECK (previous_commit ~ '^[0-9a-f]{40}$'),
				delta_sha256 text CHECK (delta_sha256 ~ '^[0-9a-f]{64}$')
			);
			CREATE TABLE expert_directory_entry (
				source text NOT NULL CHECK (source = 'stellar-expert/public-directory'),
				address text NOT NULL CHECK (address ~ '^[GC][A-Z2-7]{55}$'),
				evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
				PRIMARY KEY (source, address),
				CHECK (evidence->>'source' IS NOT NULL AND evidence->>'source' = source),
				CHECK (evidence->>'address' IS NOT NULL AND evidence->>'address' = address),
				CHECK (evidence->>'state' IS NOT NULL AND evidence->>'state' IN ('active', 'deleted'))
			);
			CREATE INDEX idx_expert_directory_address
				ON expert_directory_entry (source, address COLLATE "C")
		`);
	}

	async down(runner: QueryRunner): Promise<void> {
		await runner.query('DROP TABLE expert_directory_entry');
		await runner.query('DROP TABLE expert_directory_checkpoint');
	}
}
