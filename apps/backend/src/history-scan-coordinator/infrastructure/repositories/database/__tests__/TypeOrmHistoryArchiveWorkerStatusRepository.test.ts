import 'reflect-metadata';
import type { EntityManager, Repository } from 'typeorm';
import { HistoryArchiveWorkerStatusRow } from '../../../database/entities/HistoryArchiveWorkerStatusRow.js';
import {
	historyArchiveWorkerRegistryMaxRows,
	historyArchiveWorkerRegistryRetentionMs,
	historyArchiveWorkerRegistryLockTimeoutMs,
	historyArchiveWorkerRegistryStatementTimeoutMs,
	historyArchiveWorkerStatusFindRecentSql,
	historyArchiveWorkerStatusPruneSql,
	historyArchiveWorkerStatusRegistryLockSql,
	historyArchiveWorkerStatusTimeoutSql,
	historyArchiveWorkerStatusUpsertSql,
	TypeOrmHistoryArchiveWorkerStatusRepository
} from '../TypeOrmHistoryArchiveWorkerStatusRepository.js';

describe('TypeOrmHistoryArchiveWorkerStatusRepository', () => {
	it('upserts and prunes worker rows in one transaction', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const repository = createRepository(query);
		const heartbeatAt = new Date('2026-07-10T12:00:00.000Z');

		await repository.report(createReport(), heartbeatAt);

		expect(query).toHaveBeenNthCalledWith(
			1,
			historyArchiveWorkerStatusTimeoutSql,
			[
				`${historyArchiveWorkerRegistryLockTimeoutMs}ms`,
				`${historyArchiveWorkerRegistryStatementTimeoutMs}ms`
			]
		);
		expect(query).toHaveBeenNthCalledWith(
			2,
			historyArchiveWorkerStatusRegistryLockSql
		);
		expect(query).toHaveBeenNthCalledWith(
			3,
			historyArchiveWorkerStatusUpsertSql,
			expect.arrayContaining([
				'object-host-0-0',
				'164f7788-9edb-4bb5-81c1-b928d85a21a5',
				4123,
				2,
				9,
				'82a309de-a5df-457b-9412-f267ed5e7388',
				7,
				20,
				1024,
				3,
				heartbeatAt,
				1
			])
		);
		expect(historyArchiveWorkerStatusUpsertSql).toContain(
			'registry."sequence" < excluded."sequence"'
		);
		expect(historyArchiveWorkerStatusUpsertSql).toContain(
			'registry."processGeneration" < excluded."processGeneration"'
		);
		expect(query).toHaveBeenNthCalledWith(
			4,
			historyArchiveWorkerStatusPruneSql,
			[
				new Date(
					heartbeatAt.getTime() - historyArchiveWorkerRegistryRetentionMs
				),
				historyArchiveWorkerRegistryMaxRows
			]
		);
	});

	it('maps compact database rows into typed worker state', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				bytesDownloaded: '4096',
				claimAttempt: 4,
				heartbeatAt: new Date('2026-07-10T12:00:00.000Z'),
				lastOutcomeAt: new Date('2026-07-10T11:59:00.000Z'),
				lastOutcomeCode: 1,
				objectRemoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
				objectSource: 'https://archive.example',
				objectTypeCode: 7,
				pid: 4123,
				processGeneration: 2,
				processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
				processStartedAt: new Date('2026-07-10T11:00:00.000Z'),
				sequence: '9',
				stageCode: 20,
				workerId: 'object-host-0-0'
			}
		]);
		const repository = createRepository(query);

		const observedAfter = new Date('2026-07-10T11:45:00.000Z');
		const pruneBefore = new Date('2026-07-09T12:00:00.000Z');
		const rows = await repository.findRecent({
			limit: 5000,
			observedAfter,
			pruneBefore
		});

		expect(rows).toEqual([
			expect.objectContaining({
				bytesDownloaded: 4096,
				claimAttempt: 4,
				currentObject: {
					remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
					source: 'https://archive.example',
					type: 'bucket'
				},
				lastOutcome: 'verified',
				processGeneration: 2,
				sequence: 9,
				stage: 'verified_bucket'
			})
		]);
		expect(query).toHaveBeenNthCalledWith(
			1,
			historyArchiveWorkerStatusTimeoutSql,
			[
				`${historyArchiveWorkerRegistryLockTimeoutMs}ms`,
				`${historyArchiveWorkerRegistryStatementTimeoutMs}ms`
			]
		);
		expect(query).toHaveBeenNthCalledWith(
			2,
			historyArchiveWorkerStatusRegistryLockSql
		);
		expect(query).toHaveBeenNthCalledWith(
			3,
			historyArchiveWorkerStatusPruneSql,
			[pruneBefore, historyArchiveWorkerRegistryMaxRows]
		);
		expect(query).toHaveBeenNthCalledWith(
			4,
			historyArchiveWorkerStatusFindRecentSql,
			[observedAfter, historyArchiveWorkerRegistryMaxRows]
		);
		expect(historyArchiveWorkerStatusFindRecentSql).toContain(
			'where "heartbeatAt" >= $1'
		);
		expect(historyArchiveWorkerStatusFindRecentSql).toContain(
			'"sequence" desc'
		);
	});
});

function createRepository(query: jest.Mock) {
	const manager = {
		query,
		transaction: async <T>(callback: (value: EntityManager) => Promise<T>) =>
			callback(manager as unknown as EntityManager)
	};
	const ormRepository = {
		manager,
		query
	} as unknown as Repository<HistoryArchiveWorkerStatusRow>;

	return new TypeOrmHistoryArchiveWorkerStatusRepository(ormRepository);
}

function createReport() {
	return {
		bytesDownloaded: 1024,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket' as const
		},
		lastOutcome: 'verified' as const,
		lastOutcomeAt: '2026-07-10T11:59:00.000Z',
		pid: 4123,
		processGeneration: 2,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T11:00:00.000Z',
		sequence: 9,
		stage: 'verified_bucket' as const,
		workerId: 'object-host-0-0'
	};
}
