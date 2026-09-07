import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointScanCoverageMigration1788831000000 } from '../../../database/migrations/1788831000000-HistoryArchiveCheckpointScanCoverageMigration.js';
import {
	applyHistoryArchiveCheckpointScanPositions as positions,
	applyHistoryArchiveCheckpointScanRanges as ranges,
	recordAcceptedHistoryArchiveCheckpointScans as terminals
} from '../HistoryArchiveCheckpointScanCoverageWrite.js';

jest.setTimeout(60_000);
const root = 'https://archive.example/History';
const ledger = (position: number) => position * 64 + 63;

describe('exact compact checkpoint scan coverage', () => {
	let pg: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = await new DataSource({ type: 'postgres', url: pg.url }).initialize();
		const runner = db.createQueryRunner();
		try {
			await new HistoryArchiveCheckpointScanCoverageMigration1788831000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_checkpoint_scan_bitmap, history_archive_checkpoint_scan_summary, history_archive_checkpoint_scan_seed_state'
		);
	});

	async function summary(identity = root) {
		const rows = await db.query(
			'select "checkedCheckpointPositions", "listingCoveredCheckpointPositions", "scannedCheckpointPositions" from history_archive_checkpoint_scan_summary where "archiveUrlIdentity"=$1',
			[identity]
		);
		return rows[0];
	}

	it('creates no seed readiness fiction and does no work for empty input', async () => {
		expect(
			await db.query('select * from history_archive_checkpoint_scan_seed_state')
		).toEqual([]);
		expect(await positions(db.manager, [])).toBe(0);
		expect(await ranges(db.manager, [])).toBe(0);
		expect(
			await db.query('select * from history_archive_checkpoint_scan_summary')
		).toEqual([]);
	});

	it('deduplicates categories, retries and overlapping checked/listing masks across page boundaries', async () => {
		const checked = [0, 1, 1, 4095, 4096];
		expect(
			await db.transaction((m) =>
				positions(
					m,
					checked.map((p) => ({
						archiveUrlIdentity: root,
						checkpointLedger: ledger(p)
					}))
				)
			)
		).toBe(2);
		expect(
			await db.transaction((m) =>
				ranges(m, [
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: ledger(1),
						lastCheckpointLedger: ledger(4096)
					},
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: ledger(2),
						lastCheckpointLedger: ledger(4097)
					}
				])
			)
		).toBe(2);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '4',
			listingCoveredCheckpointPositions: '4097',
			scannedCheckpointPositions: '4098'
		});
		const before = await db.query(
			'select xmin::text, "updatedAt" from history_archive_checkpoint_scan_bitmap order by "pageIndex"'
		);
		expect(
			await db.transaction((m) =>
				positions(
					m,
					checked.map((p) => ({
						archiveUrlIdentity: root,
						checkpointLedger: ledger(p)
					}))
				)
			)
		).toBe(0);
		expect(
			await db.query(
				'select xmin::text, "updatedAt" from history_archive_checkpoint_scan_bitmap order by "pageIndex"'
			)
		).toEqual(before);
		await db.transaction((m) =>
			positions(m, [
				{ archiveUrlIdentity: root, checkpointLedger: ledger(4097) }
			])
		);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '5',
			listingCoveredCheckpointPositions: '4097',
			scannedCheckpointPositions: '4098'
		});
	});

	it('stores one million conclusively listed positions in 245 fixed-size pages', async () => {
		expect(
			await db.transaction((m) =>
				ranges(m, [
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: ledger(0),
						lastCheckpointLedger: ledger(999_999)
					}
				])
			)
		).toBe(245);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '0',
			listingCoveredCheckpointPositions: '1000000',
			scannedCheckpointPositions: '1000000'
		});
		expect(
			await db.query(
				'select max(octet_length("checkedBitmap")) as checked, max(octet_length("listingBitmap")) as listed, count(*)::integer as pages from history_archive_checkpoint_scan_bitmap'
			)
		).toEqual([{ checked: 512, listed: 512, pages: 245 }]);
	});

	it('excludes root/bucket jobs and invalid positions while preserving case-sensitive root identities', async () => {
		await db.transaction((m) =>
			terminals(m, [
				{
					archiveUrlIdentity: root,
					objectType: 'checkpoint-state',
					checkpointLedger: 63
				},
				{
					archiveUrlIdentity: root,
					objectType: 'ledger',
					checkpointLedger: 63
				},
				{
					archiveUrlIdentity: root,
					objectType: 'bucket',
					checkpointLedger: 127
				},
				{
					archiveUrlIdentity: root,
					objectType: 'history-archive-state',
					checkpointLedger: 191
				},
				{ archiveUrlIdentity: root, objectType: 'scp', checkpointLedger: null },
				{
					archiveUrlIdentity: root,
					objectType: 'results',
					checkpointLedger: 64
				},
				{
					archiveUrlIdentity: root.toLowerCase(),
					objectType: 'transactions',
					checkpointLedger: 127
				}
			])
		);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '1',
			listingCoveredCheckpointPositions: '0',
			scannedCheckpointPositions: '1'
		});
		expect(await summary(root.toLowerCase())).toEqual({
			checkedCheckpointPositions: '1',
			listingCoveredCheckpointPositions: '0',
			scannedCheckpointPositions: '1'
		});
	});

	it('rolls bitmap and summary changes back with the evidence transaction', async () => {
		await expect(
			db.transaction(async (m) => {
				await positions(m, [
					{ archiveUrlIdentity: root, checkpointLedger: 63 }
				]);
				await ranges(m, [
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: 63,
						lastCheckpointLedger: 127
					}
				]);
				throw new Error('reject terminal evidence');
			})
		).rejects.toThrow('reject terminal evidence');
		expect(await summary()).toBeUndefined();
		expect(
			await db.query('select * from history_archive_checkpoint_scan_bitmap')
		).toEqual([]);
	});

	it('serializes opposing root/page orders without lost bits, duplicated deltas or deadlocks', async () => {
		const other = 'https://z.example/history';
		await Promise.all(
			Array.from({ length: 8 }, (_, batch) =>
				db.transaction(async (m) => {
					await m.query("set local statement_timeout = '5s'");
					const roots = batch % 2 === 0 ? [root, other] : [other, root];
					await positions(
						m,
						roots.flatMap((archiveUrlIdentity) =>
							[batch, 4096 + batch, 0].map((p) => ({
								archiveUrlIdentity,
								checkpointLedger: ledger(p)
							}))
						)
					);
				})
			)
		);
		await Promise.all([
			db.transaction((m) =>
				ranges(m, [
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: ledger(0),
						lastCheckpointLedger: ledger(10)
					}
				])
			),
			db.transaction((m) =>
				positions(m, [
					{ archiveUrlIdentity: root, checkpointLedger: ledger(10) }
				])
			)
		]);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '17',
			listingCoveredCheckpointPositions: '11',
			scannedCheckpointPositions: '19'
		});
		expect(await summary(other)).toEqual({
			checkedCheckpointPositions: '16',
			listingCoveredCheckpointPositions: '0',
			scannedCheckpointPositions: '16'
		});
	});

	it('rejects malformed range input and unsafe standalone writes before any mutation', async () => {
		await expect(
			positions(db.manager, [
				{ archiveUrlIdentity: root, checkpointLedger: 63 }
			])
		).rejects.toThrow('evidence transaction');
		await expect(
			db.transaction((m) =>
				ranges(m, [
					{
						archiveUrlIdentity: root,
						firstCheckpointLedger: 127,
						lastCheckpointLedger: 63
					}
				])
			)
		).rejects.toThrow('Invalid checkpoint listing');
		expect(await summary()).toBeUndefined();
	});

	it('combines accepted failures and listing ranges in one statement amid other same-root completions', async () => {
		await Promise.all(
			Array.from({ length: 8 }, (_, batch) =>
				db.transaction(async (m) => {
					await m.query("set local statement_timeout = '5s'");
					const query = jest.spyOn(m, 'query');
					await terminals(
						m,
						[
							{
								archiveUrlIdentity: root,
								objectType: 'checkpoint-state',
								checkpointLedger: ledger(batch)
							}
						],
						batch % 2 === 0
							? [
									{
										archiveUrlIdentity: root,
										firstCheckpointLedger: ledger(batch),
										lastCheckpointLedger: ledger(8192)
									}
								]
							: []
					);
					expect(query).toHaveBeenCalledTimes(1);
				})
			)
		);
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '8',
			listingCoveredCheckpointPositions: '8193',
			scannedCheckpointPositions: '8193'
		});
	});
});
