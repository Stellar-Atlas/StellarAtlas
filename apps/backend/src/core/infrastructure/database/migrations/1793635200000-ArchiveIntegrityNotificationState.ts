import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ArchiveIntegrityNotificationState1793635200000 implements MigrationInterface {
	name = 'ArchiveIntegrityNotificationState1793635200000';
	async up(runner: QueryRunner): Promise<void> {
		await runner.query(`CREATE TABLE "archive_integrity_notification_state" (
			"subscriptionId" integer NOT NULL REFERENCES "subscription"("id") ON DELETE CASCADE,
			"findingKey" varchar(64) NOT NULL CHECK ("findingKey" ~ '^[0-9a-f]{64}$'),
			"observedFingerprint" varchar(64) NOT NULL CHECK ("observedFingerprint" ~ '^[0-9a-f]{64}$'),
			"observedAt" timestamptz NOT NULL,
			"observationConflicted" boolean NOT NULL DEFAULT false,
			"deliveredFingerprint" varchar(64) CHECK ("deliveredFingerprint" ~ '^[0-9a-f]{64}$'),
			"deliveredObservationAt" timestamptz,
			"deliveredAt" timestamptz,
			"deliveryGeneration" bigint NOT NULL DEFAULT 0 CHECK ("deliveryGeneration" >= 0),
			"acknowledgedGeneration" bigint CHECK ("acknowledgedGeneration" > 0 AND "acknowledgedGeneration" <= "deliveryGeneration"),
			PRIMARY KEY ("subscriptionId", "findingKey"),
			CHECK (("deliveredFingerprint" IS NULL AND "deliveredObservationAt" IS NULL AND "deliveredAt" IS NULL AND "acknowledgedGeneration" IS NULL)
				OR ("deliveredFingerprint" IS NOT NULL AND "deliveredObservationAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "acknowledgedGeneration" IS NOT NULL)),
			CHECK ("deliveredObservationAt" IS NULL OR "deliveredObservationAt" <= "observedAt")
		)`);
		await runner.query(
			`CREATE INDEX "IDX_archive_source_unmute" ON "subscription_event_notification_state" ("eventSubscriptionId", "eventType")`
		);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query(`DROP INDEX "IDX_archive_source_unmute"`);
		await runner.query(`DROP TABLE "archive_integrity_notification_state"`);
	}
}
