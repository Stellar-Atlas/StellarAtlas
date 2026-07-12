import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveStateRepository } from '../../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import type { Logger } from 'logger';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../infrastructure/database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../infrastructure/database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectEventRepository } from '../../../infrastructure/repositories/database/TypeOrmHistoryArchiveObjectEventRepository.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../../../infrastructure/repositories/database/TypeOrmHistoryArchiveObjectRepository.js';
import { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { CompleteHistoryArchiveObject } from '../CompleteHistoryArchiveObject.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('durable completion effects in disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveObject, HistoryArchiveObjectEvent],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
			runner
		);
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			runner
		);
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('recovers proof and audit effects after the verified transition commits', async () => {
		const object = new HistoryArchiveObject({
			archiveUrl: 'https://completion.example/archive',
			archiveUrlIdentity: 'https://completion.example/archive',
			bucketHash: 'b'.repeat(64),
			objectKey: `bucket:${'b'.repeat(64)}`,
			objectOrder: 50,
			objectType: 'bucket',
			objectUrl: `https://completion.example/archive/bucket-${'b'.repeat(64)}`,
			status: 'scanning'
		});
		object.attempts = 1;
		await dataSource.getRepository(HistoryArchiveObject).save(object);
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
		const proofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		proofRepository.refreshForObject
			.mockRejectedValueOnce(new Error('transient proof failure'))
			.mockResolvedValue(undefined);
		const eventRecorder = new HistoryArchiveObjectEventRecorder(
			new TypeOrmHistoryArchiveObjectEventRepository(
				dataSource.getRepository(HistoryArchiveObjectEvent)
			),
			mock<Logger>()
		);
		const useCase = new CompleteHistoryArchiveObject(
			objectRepository,
			mock<HistoryArchiveStateRepository>(),
			eventRecorder,
			proofRepository
		);

		const first = await useCase.execute(object.remoteId, {
			claimAttempt: 1,
			workerStage: 'verified'
		});
		expect(first._unsafeUnwrapErr().message).toBe('transient proof failure');
		expect(
			await objectRepository.findByRemoteId(object.remoteId)
		).toMatchObject({
			status: 'verified',
			transitionEffectsCompletedAt: null,
			transitionEffectsRequiredAt: expect.any(Date)
		});
		expect(
			await dataSource.getRepository(HistoryArchiveObjectEvent).count()
		).toBe(0);

		const replay = await useCase.execute(object.remoteId, {
			claimAttempt: 1,
			workerStage: 'verified'
		});
		expect(replay._unsafeUnwrap()).toBe(true);
		expect(
			await objectRepository.findByRemoteId(object.remoteId)
		).toMatchObject({
			status: 'verified',
			transitionEffectsCompletedAt: expect.any(Date)
		});
		expect(
			await dataSource.getRepository(HistoryArchiveObjectEvent).count()
		).toBe(1);
		expect(proofRepository.refreshForObject).toHaveBeenCalledTimes(2);
	});
});
