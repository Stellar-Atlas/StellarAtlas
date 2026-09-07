import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointScanCoverageMigration1788831000000 } from '../../../database/migrations/1788831000000-HistoryArchiveCheckpointScanCoverageMigration.js';
import { seedHistoryArchiveCheckpointScanChunk as seed } from '../HistoryArchiveCheckpointScanSeed.js';
import { applyHistoryArchiveCheckpointScanPositions as positions } from '../HistoryArchiveCheckpointScanCoverageWrite.js';

jest.setTimeout(60_000);
const root = 'https://a.example/History';
const other = 'https://z.example/history';
const ledger = (position: number) => position * 64 + 63;

describe('bounded resumable checkpoint scan coverage seed', () => {
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
		await db.query(`
			create table history_archive_state_snapshot (
				"archiveUrlIdentity" text primary key, "archiveUrl" text);
			create table history_archive_checkpoint_proof_attestation_rollup (
				"archiveUrlIdentity" text primary key, "durableVerifiedCheckpointProofs" bigint);
			create table history_archive_listing_gap (
				"archiveUrlIdentity" text, "firstCheckpointLedger" integer, "lastCheckpointLedger" integer,
				primary key ("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger"));
			create table history_archive_checkpoint_proof_attested_checkpoint (
				"archiveUrlIdentity" text, "checkpointLedger" integer,
				primary key ("archiveUrlIdentity", "checkpointLedger"));
			create table history_archive_object_event (
				id bigserial primary key, "archiveUrlIdentity" text, "checkpointLedger" integer,
				"objectType" text, "eventType" text);
			create table history_archive_object_queue (
				id bigserial primary key, "archiveUrlIdentity" text, "checkpointLedger" integer,
				"objectType" text, status text, attempts integer default 0);
		`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await db.query(`truncate history_archive_state_snapshot,
			history_archive_checkpoint_proof_attestation_rollup, history_archive_listing_gap,
			history_archive_checkpoint_proof_attested_checkpoint, history_archive_object_event,
			history_archive_object_queue, history_archive_checkpoint_scan_bitmap,
			history_archive_checkpoint_scan_summary, history_archive_checkpoint_scan_seed_state restart identity`);
	});
	async function summary(identity = root) {
		const rows = await db.query(
			`select "checkedCheckpointPositions", "listingCoveredCheckpointPositions",
			"scannedCheckpointPositions" from history_archive_checkpoint_scan_summary where "archiveUrlIdentity"=$1`,
			[identity]
		);
		return rows[0];
	}
	async function queue(
		checkpoint: number | null,
		status = 'verified',
		objectType = 'ledger'
	) {
		await db.query(
			`insert into history_archive_object_queue
			("archiveUrlIdentity", "checkpointLedger", status, "objectType", attempts) values ($1,$2,$3,$4,1)`,
			[root, checkpoint, status, objectType]
		);
	}
	async function attest(identity: string, checkpoints: readonly number[]) {
		await db.query(
			`insert into history_archive_checkpoint_proof_attested_checkpoint
			select $1::text, unnest($2::integer[])`,
			[identity, checkpoints]
		);
	}
	async function finish() {
		for (let i = 0; i < 12; i++) {
			const progress = await seed(db, { rowLimit: 2 });
			if (progress.complete) return progress;
		}
		throw new Error('Fixture seed did not finish within finite chunks');
	}

	it('seeds listings first, then durable proofs, events and queue without adding overlaps', async () => {
		await db.query(
			'insert into history_archive_listing_gap values ($1,63,191)',
			[root]
		);
		await attest(root, [63, 255]);
		await db.query(
			'insert into history_archive_object_event ("archiveUrlIdentity","checkpointLedger","objectType","eventType") values ($1,319,\'scp\',\'failed\')',
			[root]
		);
		await queue(127, 'failed');
		expect(await seed(db)).toMatchObject({
			source: 'listings',
			rowsRead: 1,
			evidenceRows: 1,
			complete: false
		});
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '0',
			listingCoveredCheckpointPositions: '3',
			scannedCheckpointPositions: '3'
		});
		expect(await seed(db)).toMatchObject({
			source: 'attestations',
			rowsRead: 2,
			complete: false
		});
		expect(await seed(db)).toMatchObject({
			source: 'events',
			rowsRead: 1,
			complete: false
		});
		expect(await seed(db)).toMatchObject({
			source: 'queue',
			rowsRead: 1,
			complete: true
		});
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '4',
			listingCoveredCheckpointPositions: '3',
			scannedCheckpointPositions: '5'
		});
	});

	it('bounds pending-heavy physical pages and excludes claims, buckets, root state and invalid checkpoints', async () => {
		for (const cp of [63, 127, 191, 255]) await queue(cp, 'pending');
		await queue(319, 'in_progress');
		await queue(383, 'verified', 'bucket');
		await queue(447, 'verified', 'history-archive-state');
		await queue(null);
		await queue(64);
		await queue(0);
		await queue(511, 'failed', 'transactions');
		const first = await seed(db, { rowLimit: 2 });
		expect(first).toMatchObject({
			source: 'queue',
			rowsRead: 2,
			evidenceRows: 0,
			complete: false
		});
		expect(
			await db.query(
				"select cursor from history_archive_checkpoint_scan_seed_state where source='queue'"
			)
		).toEqual([{ cursor: { id: '2' } }]);
		expect(await summary()).toBeUndefined();
		await finish();
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '1',
			listingCoveredCheckpointPositions: '0',
			scannedCheckpointPositions: '1'
		});
	});

	it('uses terminal event receipts even when queue rows no longer exist', async () => {
		await db.query(
			`insert into history_archive_object_event
			("archiveUrlIdentity","checkpointLedger","objectType","eventType") values
			($1,63,'results','failed'),($1,127,'ledger','verified'),($1,191,'scp','claimed'),
			($1,255,'bucket','failed'),($1,null,'checkpoint-state','failed')`,
			[root]
		);
		await finish();
		expect(await summary()).toEqual({
			checkedCheckpointPositions: '2',
			listingCoveredCheckpointPositions: '0',
			scannedCheckpointPositions: '2'
		});
	});

	it('resumes composite keys across roots and bitmap boundaries', async () => {
		await attest(root, [63, ledger(4096)]);
		await attest(other, [127]);
		expect(await seed(db, { rowLimit: 1 })).toMatchObject({
			source: 'attestations',
			complete: false
		});
		expect(await seed(db, { rowLimit: 1 })).toMatchObject({
			rowsRead: 1,
			complete: false
		});
		expect(await seed(db, { rowLimit: 1 })).toMatchObject({
			rowsRead: 1,
			complete: true
		});
		expect((await summary()).checkedCheckpointPositions).toBe('2');
		expect((await summary(other)).checkedCheckpointPositions).toBe('1');
		expect(
			await db.query(
				'select count(*)::integer as pages from history_archive_checkpoint_scan_bitmap'
			)
		).toEqual([{ pages: 3 }]);
	});

	it('fixes upper bounds and deduplicates live-hook positions without re-reading future rows', async () => {
		await queue(63);
		await queue(127);
		expect(await seed(db, { rowLimit: 1 })).toMatchObject({ complete: false });
		await queue(191);
		await db.transaction((m) =>
			positions(m, [
				{ archiveUrlIdentity: root, checkpointLedger: 127 },
				{ archiveUrlIdentity: root, checkpointLedger: 191 }
			])
		);
		expect(await seed(db, { rowLimit: 1 })).toMatchObject({
			rowsRead: 1,
			complete: true
		});
		expect(await seed(db)).toMatchObject({
			rowsRead: 0,
			changedPages: 0,
			complete: true
		});
		expect((await summary()).scannedCheckpointPositions).toBe('3');
		expect(
			await db.query(
				"select upper_bound,cursor from history_archive_checkpoint_scan_seed_state where source='queue'"
			)
		).toEqual([{ upper_bound: { id: '2' }, cursor: { id: '2' } }]);
	});

	it('rolls back projection and source cursor together when state persistence fails', async () => {
		await queue(63);
		await db.query(`create function reject_scan_seed_progress() returns trigger language plpgsql as
			$$ begin raise exception 'test seed progress failure'; end $$;
			create trigger reject_scan_seed_progress before update on history_archive_checkpoint_scan_seed_state
			for each row execute function reject_scan_seed_progress()`);
		try {
			await expect(seed(db)).rejects.toThrow('test seed progress failure');
			expect(await summary()).toBeUndefined();
			expect(
				await db.query(
					'select * from history_archive_checkpoint_scan_seed_state'
				)
			).toEqual([]);
		} finally {
			await db.query(
				'drop trigger reject_scan_seed_progress on history_archive_checkpoint_scan_seed_state; drop function reject_scan_seed_progress()'
			);
		}
		expect(await seed(db)).toMatchObject({ evidenceRows: 1, complete: true });
	});

	it('does not mark completion when another invocation holds the unfinished source', async () => {
		await queue(63);
		await queue(127);
		await seed(db, { rowLimit: 1 });
		const runner = db.createQueryRunner();
		await runner.startTransaction();
		try {
			await runner.query(
				"select source from history_archive_checkpoint_scan_seed_state where source='queue' for update"
			);
			expect(await seed(db)).toMatchObject({
				source: null,
				rowsRead: 0,
				complete: false
			});
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
		expect(await seed(db)).toMatchObject({ complete: true });
	});

	it('keeps readiness false when current-root scan union is below its durable proof floor', async () => {
		await db.query(
			'insert into history_archive_state_snapshot values ($1,$1),($2,$1)',
			[root, root.toLowerCase()]
		);
		await db.query(
			'insert into history_archive_checkpoint_proof_attestation_rollup values ($1,3),($2,100)',
			[root, root.toLowerCase()]
		);
		await attest(root, [63, 127]);
		const incomplete = await seed(db);
		expect(incomplete.sources.every((item) => item.complete)).toBe(true);
		expect(incomplete).toMatchObject({
			complete: false,
			durableFloorDeficits: [
				{
					archiveUrlIdentity: root,
					scannedCheckpointPositions: '2',
					durableVerifiedCheckpointProofs: '3'
				}
			]
		});
		await db.transaction((m) =>
			positions(m, [{ archiveUrlIdentity: root, checkpointLedger: 191 }])
		);
		expect(await seed(db)).toMatchObject({
			source: null,
			complete: true,
			durableFloorDeficits: []
		});
	});

	it('marks four empty sources complete and refuses unsafe chunk sizes before connecting', async () => {
		expect(await seed(db)).toMatchObject({
			source: null,
			complete: true,
			rowsRead: 0
		});
		expect(
			await db.query(
				'select source from history_archive_checkpoint_scan_seed_state where complete'
			)
		).toHaveLength(4);
		await expect(seed(db, { rowLimit: 0 })).rejects.toThrow('limit');
		await expect(seed(db, { rowLimit: 10_001 })).rejects.toThrow('limit');
	});
});
