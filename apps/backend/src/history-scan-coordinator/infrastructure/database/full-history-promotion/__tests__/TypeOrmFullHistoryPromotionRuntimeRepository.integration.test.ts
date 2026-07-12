import { DataSource } from 'typeorm';
import { fullHistoryUint64 } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryPromotionRuntimeMigration1784930000000 } from '../../../database/migrations/1784930000000-FullHistoryPromotionRuntimeMigration.js';
import { TypeOrmFullHistoryPromotionRuntimeRepository } from '../TypeOrmFullHistoryPromotionRuntimeRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('full-history promotion runtime repository', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryPromotionRuntimeRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		await new FullHistoryPromotionRuntimeMigration1784930000000().up(
			queryRunner
		);
		await queryRunner.release();
		repository = new TypeOrmFullHistoryPromotionRuntimeRepository(dataSource);
	});

	beforeEach(async () => {
		await dataSource.query('truncate "full_history_promotion_runtime"');
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('records promotion attempts and durable outcomes', async () => {
		const instanceId = '00000000-0000-4000-8000-000000000001';
		await repository.begin('test network', instanceId);
		await repository.markAttempt('test network', instanceId);
		await repository.recordOutcome('test network', instanceId, {
			checkpointLedger: 127,
			nextLedger: fullHistoryUint64(128n),
			outcome: 'promoted'
		});

		const runtime = await repository.find('test network');

		expect(runtime).toMatchObject({
			checkpointLedger: 127,
			instanceId,
			lastErrorCode: null,
			lastOutcome: 'promoted',
			nextLedger: '128',
			state: 'running'
		});
		expect(runtime?.lastAttemptAt).toBeInstanceOf(Date);
		expect(runtime?.lastSuccessAt).toBeInstanceOf(Date);
	});

	it('prevents a replaced process from overwriting current state', async () => {
		const oldInstance = '00000000-0000-4000-8000-000000000001';
		const currentInstance = '00000000-0000-4000-8000-000000000002';
		await repository.begin('test network', oldInstance);
		await repository.begin('test network', currentInstance);

		await expect(repository.stop('test network', oldInstance)).rejects.toThrow(
			'no longer owns runtime state'
		);
		await repository.recordOutcome('test network', currentInstance, {
			checkpointLedger: 191,
			nextLedger: fullHistoryUint64(128n),
			outcome: 'proof-pending'
		});

		expect(await repository.find('test network')).toMatchObject({
			checkpointLedger: 191,
			instanceId: currentInstance,
			lastOutcome: 'proof-pending',
			state: 'waiting-for-proof'
		});
	});
});
