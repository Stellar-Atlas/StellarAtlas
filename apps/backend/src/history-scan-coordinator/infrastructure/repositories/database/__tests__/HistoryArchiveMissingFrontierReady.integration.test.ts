import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { recoverMissingFrontierReady } from '../HistoryArchiveMissingFrontierReady.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import { createCheckpoint } from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('missing current-frontier ready recovery', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
	});
	beforeEach(async () => {
		// This connection belongs only to the disposable PostgreSQL instance above.
		await dataSource.query(
			'truncate "history_archive_object_ready", "history_archive_checkpoint_scan_cursor", "history_archive_object_queue" cascade'
		);
	});
	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	async function current(index: number): Promise<HistoryArchiveObject> {
		const object = createCheckpoint(index, 127);
		object.dependencyReady = true;
		object.executionDisposition = 'executable';
		object.executionReason = 'planned-frontier';
		await dataSource.getRepository(HistoryArchiveObject).save(object);
		await dataSource.query(
			'insert into "history_archive_checkpoint_scan_cursor" ("archiveUrlIdentity", "latestCheckpointLedger", "lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger") values ($1, 959, 63, 191)',
			[object.archiveUrlIdentity]
		);
		return object;
	}

	it('recovers the lost current root while unrelated ready work remains, without opening future checkpoints or changing evidence', async () => {
		const lost = await current(1);
		const unrelated = await current(2);
		const future = createCheckpoint(1, 191);
		future.dependencyReady = true;
		future.executionDisposition = 'executable';
		await dataSource.getRepository(HistoryArchiveObject).save(future);
		const dispatchToken = '00000000-0000-0000-0000-000000000123';
		await dataSource.query(
			'insert into "history_archive_object_ready" ("objectRemoteId", "archiveUrlIdentity", priority, "dispatchToken", "claimAttempt", "publishedAt") values ($1,$2,2,$3,1,now())',
			[unrelated.remoteId, unrelated.archiveUrlIdentity, dispatchToken]
		);
		const original = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId: lost.remoteId });

		expect(await recoverMissingFrontierReady(dataSource.manager, 120)).toBe(1);
		expect(await recoverMissingFrontierReady(dataSource.manager, 120)).toBe(0);
		const ready = await dataSource.query(
			'select "objectRemoteId", priority, "dispatchToken" from "history_archive_object_ready"'
		);
		expect(ready).toEqual(
			expect.arrayContaining([
				{ objectRemoteId: lost.remoteId, priority: 2, dispatchToken: null },
				{ objectRemoteId: unrelated.remoteId, priority: 2, dispatchToken }
			])
		);
		expect(ready).toHaveLength(2);
		expect(
			await dataSource
				.getRepository(HistoryArchiveObject)
				.findOneByOrFail({ remoteId: lost.remoteId })
		).toEqual(original);
	});

	it.each(['failed', 'deferred', 'dependency', 'transition'] as const)(
		'does not admit a %s-blocked current object',
		async (reason) => {
			const object = await current(1);
			if (reason === 'failed') {
				object.status = 'failed';
				object.httpStatus = 404;
			}
			if (reason === 'deferred') object.executionDisposition = 'deferred';
			if (reason === 'dependency') object.dependencyReady = false;
			if (reason === 'transition')
				object.transitionEffectsRequiredAt = new Date();
			await dataSource.getRepository(HistoryArchiveObject).save(object);
			expect(await recoverMissingFrontierReady(dataSource.manager, 120)).toBe(
				0
			);
		}
	);

	it('supports an exact-ID bounded repair and retains a pending object retry time', async () => {
		const target = await current(1);
		const other = await current(2);
		target.nextAttemptAt = new Date('2099-01-01T00:00:00.000Z');
		await dataSource.getRepository(HistoryArchiveObject).save(target);
		expect(
			await recoverMissingFrontierReady(dataSource.manager, 1, [
				target.remoteId
			])
		).toBe(1);
		const rows = await dataSource.query(
			'select "objectRemoteId", "availableAt" from "history_archive_object_ready"'
		);
		expect(rows).toEqual([
			{ objectRemoteId: target.remoteId, availableAt: target.nextAttemptAt }
		]);
		expect(rows).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ objectRemoteId: other.remoteId })
			])
		);
	});
});
