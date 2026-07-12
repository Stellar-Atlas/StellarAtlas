import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { TypeOrmHistoryArchiveObjectEventRepository } from '../TypeOrmHistoryArchiveObjectEventRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('terminal history archive object events in disposable PostgreSQL', () => {
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
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('persists one terminal event under concurrent idempotent retries', async () => {
		const repository = new TypeOrmHistoryArchiveObjectEventRepository(
			dataSource.getRepository(HistoryArchiveObjectEvent)
		);
		const object = new HistoryArchiveObject({
			archiveUrl: 'https://events.example/archive',
			archiveUrlIdentity: 'https://events.example/archive',
			objectKey: 'ledger:0000007f',
			objectOrder: 20,
			objectType: 'ledger',
			objectUrl: 'https://events.example/archive/ledger-0000007f.xdr.gz',
			status: 'verified'
		});
		object.attempts = 3;

		await Promise.all(
			Array.from({ length: 24 }, () =>
				repository.appendFromObjectIdempotently(object, {
					claimAttempt: 3,
					eventType: 'verified'
				})
			)
		);
		const count = await dataSource
			.getRepository(HistoryArchiveObjectEvent)
			.countBy({
				claimAttempt: 3,
				eventType: 'verified',
				objectRemoteId: object.remoteId
			});
		expect(count).toBe(1);
	});
});
