import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { findVerifiedCheckpointsNeedingFanout } from '../HistoryArchiveCompactPlanning.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import { createCheckpoint } from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);
describe('verified checkpoint fanout selection', () => {
	let database: DataSource;
	let postgres: DisposablePostgres;
	let expected: HistoryArchiveObject[];
	const oldCanonicalRoot = process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
	beforeAll(async () => {
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = '';
		postgres = await startDisposablePostgres();
		database = new DataSource({
			type: 'postgres',
			url: postgres.url,
			entities: [HistoryArchiveObject, HistoryArchiveCheckpointProof],
			synchronize: true,
			dropSchema: true,
			logging: false
		});
		await database.initialize();
		await createCanonicalFrontierTestSchema(database);
		const objects = [
			createCheckpoint(900, 191),
			createCheckpoint(901, 63),
			createCheckpoint(902, 63),
			createCheckpoint(903, 63),
			createCheckpoint(904, 63)
		];
		for (let index = 0; index < objects.length; index++) {
			const object = objects[index];
			object.status = index === 3 ? 'pending' : 'verified';
			object.verifiedAt = new Date(
				index === 2 ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z'
			);
			object.descendantsPlannedAt = null;
		}
		await database.getRepository(HistoryArchiveObject).save(objects);
		for (let index = 0; index < objects.length; index++) {
			const object = objects[index];
			await database.query(
				'insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values ($1,959,$2)',
				[
					object.archiveUrlIdentity,
					index === 4 ? 255 : object.checkpointLedger! + 64
				]
			);
		}
		expected = [objects[2], objects[1], objects[0]];
	});
	afterAll(async () => {
		if (oldCanonicalRoot === undefined)
			delete process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
		else process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = oldCanonicalRoot;
		if (database?.isInitialized) await database.destroy();
		if (postgres) await postgres.stop();
	});
	afterEach(() => jest.restoreAllMocks());
	it('hydrates the ordered limited cohort with one SELECT, not an ID query plus a repeated query', async () => {
		const queries = jest.spyOn(database.logger, 'logQuery');
		const rows = await findVerifiedCheckpointsNeedingFanout(
			database.getRepository(HistoryArchiveObject),
			2
		);
		expect(rows.map((row) => row.remoteId)).toEqual(
			expected.slice(0, 2).map((row) => row.remoteId)
		);
		expect(rows.every((row) => row instanceof HistoryArchiveObject)).toBe(true);
		const selects = queries.mock.calls
			.map(([sql]) => sql)
			.filter((sql) => sql.includes('canonical_scope'));
		expect(selects).toHaveLength(1);
		expect(selects[0]).not.toContain('distinctAlias');
		expect(selects[0]).toMatch(/LIMIT 2/);
	});
	it('excludes pending and non-current checkpoints while preserving oldest-first order', async () => {
		const rows = await findVerifiedCheckpointsNeedingFanout(
			database.getRepository(HistoryArchiveObject),
			10
		);
		expect(rows.map((row) => row.remoteId)).toEqual(
			expected.map((row) => row.remoteId)
		);
	});
	it('retains canonical-first gating when the preferred root is incomplete', async () => {
		const canonical = expected[0].archiveUrlIdentity;
		await database.query(
			'insert into history_archive_state_snapshot ("archiveUrlIdentity",status,"currentLedger") values ($1,\'available\',959)',
			[canonical]
		);
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = canonical;
		try {
			const rows = await findVerifiedCheckpointsNeedingFanout(
				database.getRepository(HistoryArchiveObject),
				10
			);
			expect(rows.map((row) => row.remoteId)).toEqual([expected[0].remoteId]);
		} finally {
			process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT = '';
		}
	});
	it('does no SQL when no fanout is requested', async () => {
		const queries = jest.spyOn(database.logger, 'logQuery');
		await expect(
			findVerifiedCheckpointsNeedingFanout(
				database.getRepository(HistoryArchiveObject),
				0
			)
		).resolves.toEqual([]);
		expect(queries).not.toHaveBeenCalled();
	});
	it('the cursor key prevents the join from duplicating an object', async () => {
		await expect(
			database.query(
				'insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values ($1,959,127)',
				[expected[0].archiveUrlIdentity]
			)
		).rejects.toMatchObject({ code: '23505' });
	});
});
