import { DataSource } from 'typeorm';

export class HistoryArchiveIntegrityNotificationRunLock {
	constructor(private readonly dataSource: DataSource) {}

	async tryRun<T>(
		work: () => Promise<T>
	): Promise<{ readonly acquired: boolean; readonly value?: T }> {
		const queryRunner = this.dataSource.createQueryRunner();
		await queryRunner.connect();
		const [result] = (await queryRunner.query(
			"select pg_try_advisory_lock(hashtextextended('history-archive-integrity-notification-run-v1', 0)) as locked"
		)) as readonly { locked: boolean }[];
		if (result?.locked !== true) {
			await queryRunner.release();
			return { acquired: false };
		}

		try {
			return { acquired: true, value: await work() };
		} finally {
			await queryRunner.query(
				"select pg_advisory_unlock(hashtextextended('history-archive-integrity-notification-run-v1', 0))"
			);
			await queryRunner.release();
		}
	}
}
