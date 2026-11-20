import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyEmailGate1795176000000 implements MigrationInterface {
	name = 'WeeklyEmailGate1795176000000';
	async up(runner: QueryRunner): Promise<void> {
		await runner.query(`CREATE TABLE IF NOT EXISTS email_delivery_gate (
			recipient_key text PRIMARY KEY,
			next_allowed_at timestamptz NOT NULL,
			attempt_token uuid NOT NULL
		)`);
	}
	async down(): Promise<void> {
		throw new Error(
			'Retain email delivery gates when rolling back application code'
		);
	}
}
