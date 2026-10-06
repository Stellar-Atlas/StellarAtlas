import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	historyArchiveRamFeedNotificationsSql,
	dropHistoryArchiveRamFeedNotificationsSql
} from '../../repositories/database/HistoryArchiveRamFeedNotifications.js';

/** Add notification-only triggers; no row rewrite, journal, or new tables. */
export class HistoryArchiveRamFeedNotificationsMigration1791324000000 implements MigrationInterface {
	name = 'HistoryArchiveRamFeedNotificationsMigration1791324000000';
	async up(queryRunner: QueryRunner): Promise<void> {
		if (!queryRunner.isTransactionActive)
			throw new Error(
				'RAM notification migration requires an explicit transaction'
			);
		await queryRunner.query("set local lock_timeout = '250ms'");
		await queryRunner.query("set local statement_timeout = '5s'");
		// Reapplying only these named notification objects is atomic and idempotent.
		await queryRunner.query(dropHistoryArchiveRamFeedNotificationsSql);
		await queryRunner.query(historyArchiveRamFeedNotificationsSql);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		if (!queryRunner.isTransactionActive)
			throw new Error(
				'RAM notification migration requires an explicit transaction'
			);
		await queryRunner.query("set local lock_timeout = '250ms'");
		await queryRunner.query("set local statement_timeout = '5s'");
		await queryRunner.query(dropHistoryArchiveRamFeedNotificationsSql);
	}
}
