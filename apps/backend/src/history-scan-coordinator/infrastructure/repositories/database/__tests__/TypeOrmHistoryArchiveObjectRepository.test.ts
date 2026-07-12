import type { Repository } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';

describe('TypeOrmHistoryArchiveObjectRepository', () => {
	it('holds a cross-process advisory lock while transition effects run', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ locked: true }])
			.mockResolvedValueOnce([{ pg_advisory_unlock: true }]);
		const release = jest.fn(async () => undefined);
		const repository = {
			manager: {
				connection: {
					createQueryRunner: () => ({
						connect: jest.fn(async () => undefined),
						query,
						release
					})
				}
			}
		} as unknown as Repository<HistoryArchiveObject>;
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			repository
		);
		const work = jest.fn(async () => undefined);

		await expect(
			objectRepository.tryWithTransitionReconciliationLock(work)
		).resolves.toBe(true);

		expect(work).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain('pg_try_advisory_lock');
		expect(query.mock.calls[1]?.[0]).toContain('pg_advisory_unlock');
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('skips transition reconciliation when another process owns the lock', async () => {
		const query = jest.fn(async () => [{ locked: false }]);
		const release = jest.fn(async () => undefined);
		const repository = {
			manager: {
				connection: {
					createQueryRunner: () => ({
						connect: jest.fn(async () => undefined),
						query,
						release
					})
				}
			}
		} as unknown as Repository<HistoryArchiveObject>;
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			repository
		);
		const work = jest.fn(async () => undefined);

		await expect(
			objectRepository.tryWithTransitionReconciliationLock(work)
		).resolves.toBe(false);

		expect(work).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('finds the latest live activity or terminal evidence with bounded index probes', async () => {
		const query = jest.fn(async (_sql: string): Promise<unknown[]> => [
			{ latestActivityAt: '2026-07-10T12:00:00.000Z' }
		]);
		const repository = {
			query
		} as unknown as Repository<HistoryArchiveObject>;
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			repository
		);

		await expect(objectRepository.findLatestActivityAt()).resolves.toEqual(
			new Date('2026-07-10T12:00:00.000Z')
		);
		const sql = query.mock.calls[0]?.[0];
		expect(sql).toContain("where archive_object.status = 'scanning'");
		expect(sql).toContain('where object_event."eventType" = \'verified\'');
		expect(sql).toContain('where object_event."eventType" = \'failed\'');
		expect(sql?.match(/limit 1/g) ?? []).toHaveLength(4);
	});

	it('returns null when no object activity or evidence exists', async () => {
		const repository = {
			query: jest.fn(async (): Promise<unknown[]> => [])
		} as unknown as Repository<HistoryArchiveObject>;
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			repository
		);

		await expect(objectRepository.findLatestActivityAt()).resolves.toBeNull();
	});

	it('rejects invalid activity timestamps', async () => {
		const repository = {
			query: jest.fn(async (): Promise<unknown[]> => [{ latestActivityAt: 42 }])
		} as unknown as Repository<HistoryArchiveObject>;
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			repository
		);

		await expect(objectRepository.findLatestActivityAt()).rejects.toThrow(
			'Archive object activity query returned an invalid date'
		);
	});
});
