import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { TypeOrmHistoryArchiveObjectEventRepository } from '../TypeOrmHistoryArchiveObjectEventRepository.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
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
		await dataSource.query(`
			create table history_archive_object_event_summary (
				"archiveUrlIdentity" text not null,
				"objectType" text not null,
				"eventType" text not null,
				"evidenceClass" text not null,
				"eventCount" bigint not null,
				primary key (
					"archiveUrlIdentity", "objectType", "eventType", "evidenceClass"
				)
			)
		`);
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

	it('persists events and transition completion with set-based writes', async () => {
		const eventRepository = new TypeOrmHistoryArchiveObjectEventRepository(
			dataSource.getRepository(HistoryArchiveObjectEvent)
		);
		const objectRepository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
		const objects = [127, 191].map((checkpointLedger, index) => {
			const object = new HistoryArchiveObject({
				archiveUrl: 'https://batch-events.example/archive',
				archiveUrlIdentity: 'https://batch-events.example/archive',
				checkpointLedger,
				objectKey: `ledger:${checkpointLedger.toString(16).padStart(8, '0')}`,
				objectOrder: 20,
				objectType: 'ledger',
				objectUrl: `https://batch-events.example/archive/ledger-${checkpointLedger}.xdr.gz`,
				status: 'verified'
			});
			object.attempts = index + 1;
			object.transitionEffectsRequiredAt = new Date();
			return object;
		});
		await dataSource.getRepository(HistoryArchiveObject).save(objects);

		await eventRepository.appendFromObjectsIdempotently(
			objects.map((object) => ({
				object,
				options: {
					claimAttempt: object.attempts,
					eventType: 'verified'
				}
			}))
		);
		const completed =
			await objectRepository.markTransitionEffectsCompletedBatch(
				objects.map((object) => ({
					claimAttempt: object.attempts,
					remoteId: object.remoteId,
					status: 'verified'
				}))
			);

		expect([...completed].sort()).toEqual(
			objects.map((object) => object.remoteId).sort()
		);
		expect(
			await dataSource.getRepository(HistoryArchiveObjectEvent).countBy({
				archiveUrlIdentity: 'https://batch-events.example/archive',
				eventType: 'verified'
			})
		).toBe(2);
		const persisted = await objectRepository.findByRemoteIds(
			objects.map((object) => object.remoteId)
		);
		expect(
			persisted.every(
				(object) => object.transitionEffectsCompletedAt instanceof Date
			)
		).toBe(true);
	});

	it('reads recent events with a maintained summary count', async () => {
		const repository = new TypeOrmHistoryArchiveObjectEventRepository(
			dataSource.getRepository(HistoryArchiveObjectEvent)
		);
		const object = new HistoryArchiveObject({
			archiveUrl: 'https://recent.example/archive',
			archiveUrlIdentity: 'https://recent.example/archive',
			objectKey: 'transactions:000000bf',
			objectOrder: 30,
			objectType: 'transactions',
			objectUrl: 'https://recent.example/archive/transactions-000000bf.xdr.gz',
			status: 'verified'
		});
		await repository.appendFromObject(object, { eventType: 'claimed' });
		await repository.appendFromObject(object, { eventType: 'verified' });
		await dataSource.query(
			`insert into history_archive_object_event_summary (
				"archiveUrlIdentity", "objectType", "eventType", "evidenceClass",
				"eventCount"
			) values
				($1, 'transactions', 'claimed', '', 1),
				($1, 'transactions', 'verified', '', 1)`,
			['https://recent.example/archive']
		);

		const page = await repository.findRecent({
			archiveUrlIdentity: 'https://recent.example/archive',
			limit: 1
		});

		expect(page.count).toBe(2);
		expect(page.events).toHaveLength(1);
		expect(page.limit).toBe(1);
	});
});
