import { DataSource } from 'typeorm';
import type { HistoryArchiveStatusSourceV1 } from 'shared';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveFailureSummarySnapshotMigration1788832000000 } from '../../../database/migrations/1788832000000-HistoryArchiveFailureSummarySnapshotMigration.js';
import { refreshNextKnownArchiveFailureSummary as refresh } from '../KnownArchiveFailureSummaryRefresh.js';
import {
	attachArchiveFailureSummaries as attach,
	readKnownArchiveFailureSummarySnapshots as read
} from '../KnownArchiveFailureSummarySnapshot.js';
import { emptyArchiveFailureSummary } from '../KnownArchiveFailureSummaryValue.js';

jest.setTimeout(60_000);
const root = 'https://archive.example/Case';
const other = 'https://z.example/history';
const summary = () => ({
	...emptyArchiveFailureSummary(new Date()),
	remoteFailureCount: 5,
	knownAffectedCheckpointCount: 2,
	groups: [
		{
			objectType: 'scp' as const,
			failureChannel: 'archive_availability' as const,
			errorType: 'archive_http_error',
			errorMessage: 'HTTP 404',
			httpStatus: 404,
			count: 5,
			knownAffectedCheckpointCount: 2,
			unknownCheckpointFailureCount: 0
		}
	],
	totalGroups: 1
});
const source = (identity: string, failures: number) =>
	({
		archiveUrlIdentity: identity,
		archiveEvidenceFailures: failures,
		scannerIssueFailures: 7
	}) as HistoryArchiveStatusSourceV1;

describe('shared exact failure-summary snapshots', () => {
	let pg: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = await new DataSource({ type: 'postgres', url: pg.url }).initialize();
		const runner = db.createQueryRunner();
		try {
			await new HistoryArchiveFailureSummarySnapshotMigration1788832000000().up(
				runner
			);
		} finally {
			await runner.release();
		}
		await db.query(`create table history_archive_state_snapshot ("archiveUrlIdentity" text primary key,"archiveUrl" text);
			create table history_archive_evidence_root_summary ("archiveUrlIdentity" text primary key,"remoteFailureObjects" bigint);
			create table history_archive_retained_remote_summary ("archiveUrlIdentity" text,"retainedObjects" bigint)`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_failure_summary_snapshot,history_archive_state_snapshot,history_archive_evidence_root_summary,history_archive_retained_remote_summary'
		);
		await db.query(
			'insert into history_archive_state_snapshot values ($1,$1),($2,$2),($3,$1)',
			[root, other, root.toLowerCase()]
		);
		await db.query(
			'insert into history_archive_evidence_root_summary values ($1,5),($2,0),($3,100)',
			[root, other, root.toLowerCase()]
		);
	});
	it('refreshes one trusted nonzero root and does no fact query for zero or quarantined roots', async () => {
		const load = jest.fn(async () => summary());
		expect(await refresh(db, load)).toEqual({ root, errorCode: null });
		expect(await refresh(db, load)).toBeNull();
		expect(load).toHaveBeenCalledTimes(1);
		expect((await read(db.manager, [root])).get(root)?.remoteFailureCount).toBe(
			5
		);
	});
	it('reads inventory snapshots in one query and immediately overrides stale nonzero snapshots with current zero', async () => {
		await refresh(db, async () => summary());
		const spy = jest.spyOn(db.logger, 'logQuery');
		const values = await attach(db.manager, [
			source(root, 5),
			source(other, 0)
		]);
		expect(
			spy.mock.calls.filter(([sql]) =>
				sql.includes('select "archiveUrlIdentity", summary')
			)
		).toHaveLength(1);
		expect(spy.mock.calls.length).toBeLessThanOrEqual(2); // one cached schema readiness check at most
		expect(values[0].failureSummary?.knownAffectedCheckpointCount).toBe(2);
		expect(values[1].failureSummary).toMatchObject({
			status: 'current',
			remoteFailureCount: 0,
			workerIssueCount: 7
		});
		spy.mockClear();
		expect(
			(await attach(db.manager, [source(root, 0)]))[0].failureSummary?.groups
		).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
	it('preserves last successful causes on timeout and marks them stale, never silently empty', async () => {
		await refresh(db, async () => summary());
		await db.query(
			'update history_archive_failure_summary_snapshot set "lastAttemptAt"=now()-interval \'6 minutes\''
		);
		expect(
			await refresh(db, async () => {
				throw { code: '57014' };
			})
		).toEqual({ root, errorCode: '57014' });
		expect((await read(db.manager, [root])).get(root)).toMatchObject({
			status: 'stale',
			remoteFailureCount: 5
		});
		expect(await refresh(db, async () => summary())).toBeNull();
	});
	it('marks count-changed snapshots stale and missing snapshots unavailable without cold aggregation', async () => {
		await refresh(db, async () => summary());
		const values = await attach(db.manager, [
			source(root, 6),
			source(other, 2)
		]);
		expect(values[0].failureSummary?.status).toBe('stale');
		expect(values[1].failureSummary?.status).toBe('unavailable');
	});
});
