import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalSMTPUserMigration1742387934546 implements MigrationInterface {
	name = 'LocalSMTPUserMigration1742387934546';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Check if users table already exists to avoid conflicts
		const hasUsersTable = await queryRunner.hasTable('users');
		if (hasUsersTable) {
			return;
		}

		// Create users table
		await queryRunner.query(`
			CREATE TABLE "users" (
				"id" uuid NOT NULL DEFAULT gen_random_uuid(),
				"email" varchar(255) NOT NULL,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_users_email" UNIQUE ("email")
			)
		`);

		// Create indexes
		await queryRunner.query(`CREATE INDEX "IDX_users_id" ON "users" ("id")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email")`);

		// Migrate existing user IDs from subscription_subscriber table
		const existingUserIds = await queryRunner.manager.query(`
			SELECT DISTINCT "userIdValue" 
			FROM "subscription_subscriber" 
			WHERE "userIdValue" IS NOT NULL
		`);

		// Create placeholder user records for existing subscriptions
		for (const row of existingUserIds) {
			const userId = row.userIdValue;
			// Create user with placeholder email (will need to be updated manually or through admin interface)
			const placeholderEmail = `user-${userId}@stellaratlas.io`;
			
			await queryRunner.query(`
				INSERT INTO "users" ("id", "email", "createdAt", "updatedAt")
				VALUES ($1, $2, now(), now())
				ON CONFLICT ("id") DO NOTHING
			`, [userId, placeholderEmail]);
		}
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// Check if table exists before dropping
		const hasUsersTable = await queryRunner.hasTable('users');
		if (!hasUsersTable) {
			return;
		}

		// Drop indexes first
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_id"`);
		
		// Drop table
		await queryRunner.query(`DROP TABLE "users"`);
	}
}