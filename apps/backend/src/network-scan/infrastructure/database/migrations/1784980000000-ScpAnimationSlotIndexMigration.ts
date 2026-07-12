import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexName = 'idx_scp_statement_animation_slot';

export class ScpAnimationSlotIndexMigration1784980000000 implements MigrationInterface {
	readonly name = 'ScpAnimationSlotIndexMigration1784980000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on scp_statement_observation (
				"slotIndex" desc,
				"observedAt" asc,
				"statementHash" asc
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}
