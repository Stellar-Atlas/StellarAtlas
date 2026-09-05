import { evidenceHealthSql } from '../HistoryArchiveObjectStatusSummaryQuery.js';
import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { historyArchiveObjectVerifiedBatchSql } from '../HistoryArchiveObjectLeaseWrite.js';
import { resolveVerifiedRemoteFindingsSql } from '../HistoryArchiveRetainedRemoteFindingSql.js';
import { findKnownArchiveFailurePage } from '../KnownArchiveFailurePageQuery.js';
import { retainedRemoteCountSql } from '../RetainedRemoteFindingQuery.js';
import {
	createKnownEvidenceDataSource,
	createEvidenceObject,
	evidenceRootA,
	evidenceRootB,
	resetKnownEvidence,
	saveEvidenceNetworkStates
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(120_000);

describe('retained unresolved source findings (PostgreSQL)', () => {
	let database: DataSource;
	let postgres: DisposablePostgres;
	const snapshotAt = new Date('2030-01-01T00:00:00Z');

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		database = await createKnownEvidenceDataSource(postgres.url, false);
		const triggers = await database.query(
			"select tgenabled from pg_trigger where tgname = 'history_archive_retain_remote_transition'"
		);
		expect(triggers).toEqual([{ tgenabled: 'D' }]);
		await database.query(
			'alter table history_archive_object_queue enable trigger history_archive_retain_remote_transition'
		);
		await database.query(`
			create table history_archive_object_ready (
				"objectRemoteId" uuid primary key, "dispatchToken" uuid, "claimAttempt" integer
			);
			create table history_archive_object_claim_slot (
				slot integer primary key, "objectRemoteId" uuid, "claimAttempt" integer,
				"claimedAt" timestamptz, "updatedAt" timestamptz
			);
		`);
	});
	afterAll(async () => {
		if (database?.isInitialized) await database.destroy();
		if (postgres !== undefined) await postgres.stop();
	});
	beforeEach(async () => {
		await resetKnownEvidence(database);
		await database.query(
			'truncate history_archive_object_ready, history_archive_object_claim_slot'
		);
	});

	it('preserves a source 404 through a legacy claim, worker failure, and non-source updates', async () => {
		const object = await remoteFailure(evidenceRootA, 'ledger:0000003f');
		expect(await retainedCount()).toBe(0);
		expect((await failures()).total).toBe(1);
		await claim(object);
		expect(await retainedCount()).toBe(1);
		await workerFailure(object);
		await saveEvidenceNetworkStates(database, [
			[evidenceRootA, 'test network']
		]);
		const health = await database.query(evidenceHealthSql);
		expect(health[0]).toMatchObject({
			archiveEvidenceFailures: '1',
			scannerIssueFailures: '1',
			unclassifiedFailures: '0'
		});
		const page = await failures();
		expect(page.total).toBe(1);
		expect(page.failures).toHaveLength(1);
		expect(page.failures[0]?.object.failureChannel).toBe('scanner_issue');
		expect(page.failures[0]?.object.errorType).toBe('LOCAL_WORKER_FAILURE');
		expect(page.failures[0]?.retainedFinding).toMatchObject({
			errorType: 'HISTORY_FILE_NOT_FOUND',
			httpStatus: 404,
			failureChannel: 'archive_availability'
		});
		expect((await failures('infrastructure')).total).toBe(1);
		const before = await database.query(
			'select xmin::text from history_archive_retained_remote_finding'
		);
		// Heartbeat/facts/canonical-progress changes must not resolve source evidence.
		await database.query(
			`update history_archive_object_queue
			set "updatedAt" = now(), "verificationFacts" = '{}'::jsonb
			where "remoteId" = $1`,
			[object.remoteId]
		);
		expect(
			await database.query(
				'select xmin::text from history_archive_retained_remote_finding'
			)
		).toEqual(before);
		expect(await retainedCount()).toBe(1);
	});

	it('does not manufacture remote evidence from scanner-only failures', async () => {
		const object = createEvidenceObject(
			evidenceRootA,
			'ledger:0000003f',
			'ledger',
			'scanning'
		);
		await database.getRepository(HistoryArchiveObject).save(object);
		await workerFailure(object);
		expect(await retainedCount()).toBe(0);
		expect((await failures()).total).toBe(0);
		expect((await failures('infrastructure')).total).toBe(1);
	});

	it('keeps old current failures visible and avoids double counting a repeated remote failure', async () => {
		const object = await remoteFailure(evidenceRootA, 'ledger:0000003f');
		await claim(object);
		await workerFailure(object);
		await database.query(
			`update history_archive_object_queue set status = 'failed',
			"failureChannel" = 'archive_evidence', "errorType" = 'HASH_MISMATCH',
			"httpStatus" = 200, "errorMessage" = 'Source hash mismatch', "updatedAt" = now()
			where "remoteId" = $1`,
			[object.remoteId]
		);
		expect(await retainedCount()).toBe(0);
		const page = await failures();
		expect(page.total).toBe(1);
		expect(page.failures).toHaveLength(1);
		expect(page.failures[0]?.object.errorType).toBe('HASH_MISMATCH');
		expect(page.failures[0]?.retainedFinding).toBeUndefined();
		await claim(object);
		expect(await retainedCount()).toBe(1);
		expect((await failures()).failures[0]?.retainedFinding?.errorType).toBe(
			'HASH_MISMATCH'
		);
	});

	it('uses root/type/snapshot/keyset filters across disjoint current and retained branches', async () => {
		const first = await remoteFailure(evidenceRootA, 'ledger:0000003f');
		const second = await remoteFailure(evidenceRootA, 'ledger:0000007f');
		await remoteFailure(evidenceRootB, 'ledger:0000003f');
		await database.query(
			`update history_archive_object_queue set "createdAt" = $1
			where "remoteId" = $2`,
			['2026-01-01T00:00:00Z', first.remoteId]
		);
		await database.query(
			`update history_archive_object_queue set "createdAt" = $1
			where "remoteId" = $2`,
			['2026-01-02T00:00:00Z', second.remoteId]
		);
		await claim(first);
		const one = await failures('remote', null, 1);
		expect(one.total).toBe(2);
		expect(one.failures.map((row) => row.object.remoteId)).toEqual([
			second.remoteId,
			first.remoteId
		]);
		const two = await failures(
			'remote',
			{
				at: new Date('2026-01-02T00:00:00Z'),
				remoteId: second.remoteId
			},
			1,
			new Date('2026-01-02T00:00:00Z')
		);
		// Use the persisted stable key, not latest retry time.
		expect(two.failures.map((row) => row.object.remoteId)).toEqual([
			first.remoteId
		]);
		const beforeSecond = await failures(
			'remote',
			null,
			10,
			new Date('2026-01-01T12:00:00Z')
		);
		expect(beforeSecond.total).toBe(1);
		expect(beforeSecond.failures[0]?.object.remoteId).toBe(first.remoteId);
	});

	it('resolves only source IDs accepted by the real legacy/broker completion fences', async () => {
		const object = await remoteFailure(evidenceRootA, 'ledger:0000003f');
		const other = await remoteFailure(evidenceRootB, 'ledger:0000003f');
		await claim(object);
		await claim(other);
		expect(await complete(object, 99)).toEqual([]);
		expect(await retainedCount()).toBe(1);
		expect(await complete(other, 1)).toEqual([other.remoteId]);
		expect(await retainedCount()).toBe(1);
		expect(await complete(object, 1)).toEqual([object.remoteId]);
		expect(await retainedCount()).toBe(0);

		const broker = await remoteFailure(evidenceRootA, 'ledger:0000007f');
		await workerFailure(broker);
		const executionId = '11111111-1111-4111-8111-111111111111';
		await database.query(
			`insert into history_archive_object_ready values ($1, $2, 2)`,
			[broker.remoteId, executionId]
		);
		expect(
			await complete(broker, 2, '22222222-2222-4222-8222-222222222222')
		).toEqual([]);
		expect(await retainedCount()).toBe(1);
		expect(await complete(broker, 2, executionId)).toEqual([broker.remoteId]);
		expect(await retainedCount()).toBe(0);
		expect((await failures()).total).toBe(0);
	});

	it('batches opposing root orders without counter deadlocks or lost updates', async () => {
		// Isolate this new statement-level path from historical row-level fixture rollups.
		await database.query(
			'alter table history_archive_object_queue disable trigger user'
		);
		await database.query(
			'alter table history_archive_object_queue enable trigger history_archive_retain_remote_transition'
		);
		const a1 = await remoteFailure(evidenceRootA, 'ledger:a1');
		const b1 = await remoteFailure(evidenceRootB, 'ledger:b1');
		const b2 = await remoteFailure(evidenceRootB, 'ledger:b2');
		const a2 = await remoteFailure(evidenceRootA, 'ledger:a2');
		const batches = [
			[a1.remoteId, b1.remoteId],
			[b2.remoteId, a2.remoteId]
		];
		for (let round = 0; round < 6; round++) {
			const channel =
				round % 2 === 0 ? 'scanner_issue' : 'archive_availability';
			await Promise.all(
				batches.map((ids) =>
					database.transaction(async (manager) => {
						await manager.query("set local lock_timeout = '3s'");
						await manager.query(
							`with locked as materialized (
					select "remoteId" from history_archive_object_queue
					where "remoteId" = any($1::uuid[])
					order by array_position($1::uuid[], "remoteId") for update
				) update history_archive_object_queue object set status = 'failed',
					"failureChannel" = $2, "errorType" = $2, "updatedAt" = now()
					from locked where object."remoteId" = locked."remoteId"`,
							[ids, channel]
						);
					})
				)
			);
			const expected = channel === 'scanner_issue' ? 2 : 0;
			expect(await retainedCount()).toBe(expected);
			const counts = await database.query(
				'select "archiveUrlIdentity", sum("retainedObjects")::integer as count from history_archive_retained_remote_summary group by "archiveUrlIdentity"'
			);
			expect(counts).toEqual(
				expect.arrayContaining([
					{ archiveUrlIdentity: evidenceRootA, count: expected },
					{ archiveUrlIdentity: evidenceRootB, count: expected }
				])
			);
		}
	});

	async function remoteFailure(
		root: string,
		key: string
	): Promise<HistoryArchiveObject> {
		const object = createEvidenceObject(root, key, 'ledger', 'failed');
		object.failureChannel = 'archive_availability';
		object.errorType = 'HISTORY_FILE_NOT_FOUND';
		object.errorMessage = 'Source returned 404';
		object.httpStatus = 404;
		await database.getRepository(HistoryArchiveObject).save(object);
		return object;
	}
	async function claim(object: HistoryArchiveObject): Promise<void> {
		await database.query(
			`update history_archive_object_queue set status = 'scanning',
			attempts = 1, "errorType" = null, "errorMessage" = null, "httpStatus" = null,
			"updatedAt" = now() where "remoteId" = $1`,
			[object.remoteId]
		);
	}
	async function workerFailure(object: HistoryArchiveObject): Promise<void> {
		await database.query(
			`update history_archive_object_queue set status = 'failed',
			"failureChannel" = 'scanner_issue', "errorType" = 'LOCAL_WORKER_FAILURE',
			"errorMessage" = 'Worker unavailable', "httpStatus" = null, "updatedAt" = now()
			where "remoteId" = $1`,
			[object.remoteId]
		);
	}
	async function retainedCount(): Promise<number> {
		const rows = await database.query(
			`select ${retainedRemoteCountSql('$1::text')} as count`,
			[evidenceRootA]
		);
		return Number(rows[0].count);
	}
	async function failures(
		kind: 'remote' | 'infrastructure' = 'remote',
		before: { at: Date; remoteId: string } | null = null,
		limit = 10,
		snapshot = snapshotAt
	) {
		return findKnownArchiveFailurePage(
			database.manager,
			[evidenceRootA],
			{
				before,
				limit,
				snapshotAt: snapshot,
				snapshotTotal: null,
				filters: { archiveUrlIdentity: evidenceRootA, objectType: 'ledger' }
			},
			kind
		);
	}
	async function complete(
		object: HistoryArchiveObject,
		claimAttempt: number,
		executionId?: string
	) {
		return database.transaction(async (manager) => {
			const rows: { remoteId: string }[] = await manager.query(
				historyArchiveObjectVerifiedBatchSql,
				[
					JSON.stringify([
						{
							remoteId: object.remoteId,
							claimAttempt,
							executionId: executionId ?? null,
							scheduler: executionId === undefined ? 'legacy' : 'broker',
							hasBytesDownloaded: false,
							hasVerificationFacts: false
						}
					])
				]
			);
			if (rows.length > 0)
				await manager.query(resolveVerifiedRemoteFindingsSql, [
					rows.map((row) => row.remoteId)
				]);
			return rows.map((row) => row.remoteId);
		});
	}
});
