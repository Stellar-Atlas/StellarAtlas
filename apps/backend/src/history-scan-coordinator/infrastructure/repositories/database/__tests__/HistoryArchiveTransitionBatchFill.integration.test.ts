import type { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	checkpointObject,
	createObjectRepositoryDataSource,
	rootObject
} from './HistoryArchiveObjectRepositoryFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { findPrioritizedHistoryArchiveObjectTransitions } from '../HistoryArchiveObjectTransitionQuery.js';

jest.setTimeout(60_000);

describe('archive terminal reconciliation batch fill', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource } = await createObjectRepositoryDataSource(postgres.url));
		await dataSource.query(`create table history_archive_checkpoint_scan_cursor (
			"archiveUrlIdentity" text primary key,
			"nextHistoricalCheckpointLedger" integer not null
		)`);
	});
	beforeEach(async () => {
		await dataSource.query(
			'truncate history_archive_checkpoint_scan_cursor, history_archive_object_queue restart identity cascade'
		);
	});
	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres) await postgres.stop();
	});

	async function seed() {
		const archiveUrl = 'https://frontier.example/archive';
		const target = checkpointObject(archiveUrl, 127, 'verified');
		target.transitionEffectsRequiredAt = new Date('2026-01-02T00:00:00Z');
		target.transitionEffectsCompletedAt = null;
		const generic = rootObject('https://older.example/archive', 'verified');
		generic.executionReason = 'planned-frontier';
		generic.transitionEffectsRequiredAt = new Date('2026-01-01T00:00:00Z');
		generic.transitionEffectsCompletedAt = null;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([generic, target]);
		await dataSource.query(
			`insert into history_archive_checkpoint_scan_cursor
			("archiveUrlIdentity", "nextHistoricalCheckpointLedger") values ($1, 191)`,
			[archiveUrl]
		);
		return { target, generic };
	}

	it('fills spare capacity despite current frontier work, keeping frontier first and excluding duplicates', async () => {
		const { target, generic } = await seed();
		const selected = await findPrioritizedHistoryArchiveObjectTransitions(
			dataSource.getRepository(HistoryArchiveObject),
			3,
			2
		);
		expect(selected.map((object) => object.remoteId)).toEqual([
			target.remoteId,
			generic.remoteId
		]);
	});

	it('keeps the existing batch bound and prioritizes current frontier when full', async () => {
		const { target } = await seed();
		const selected = await findPrioritizedHistoryArchiveObjectTransitions(
			dataSource.getRepository(HistoryArchiveObject),
			1,
			2
		);
		expect(selected.map((object) => object.remoteId)).toEqual([
			target.remoteId
		]);
	});

	it('still finds generic effects when there is no frontier work', async () => {
		const { target, generic } = await seed();
		await dataSource.query(
			'update history_archive_object_queue set "transitionEffectsCompletedAt"=now() where "remoteId"=$1',
			[target.remoteId]
		);
		const selected = await findPrioritizedHistoryArchiveObjectTransitions(
			dataSource.getRepository(HistoryArchiveObject),
			3,
			2
		);
		expect(selected.map((object) => object.remoteId)).toEqual([
			generic.remoteId
		]);
	});
});
