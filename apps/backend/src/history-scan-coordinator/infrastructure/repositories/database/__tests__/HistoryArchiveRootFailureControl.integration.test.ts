import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';
import { markHistoryArchiveObjectFailed } from '../HistoryArchiveObjectFailureWrite.js';
import { historyArchiveObjectVerifiedBatchSql } from '../HistoryArchiveObjectLeaseWrite.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import { classifyRootFailure } from '../HistoryArchiveRootFailureControl.js';
import { historyArchiveObjectClaimSql } from '../HistoryArchiveObjectClaimSql.js';
import { HistoryArchiveSharedBucketSetShadowMigration1788494000000 } from '../../../database/migrations/1788494000000-HistoryArchiveSharedBucketSetShadowMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';

jest.setTimeout(60_000);
const root = 'https://shared.example/archive-a';
const healthy = 'https://shared.example/archive-b';
describe('root/category failure control', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		const runner = db.createQueryRunner();
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			runner
		);
		await new HistoryArchiveSharedBucketSetShadowMigration1788494000000().up(
			runner
		);
		await runner.release();
		await db.query(`create table history_archive_object_ready (
      "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,priority smallint not null,
      "availableAt" timestamptz not null,"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
      "recheckRequestedAt" timestamptz,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null default now())`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query('truncate history_archive_object_ready');
		await resetKnownEvidence(db);
	});
	async function seed(
		checkpoint: number,
		url = root,
		type: HistoryArchiveObject['objectType'] = 'checkpoint-state',
		published = true,
		priority = 1
	) {
		const object = createEvidenceObject(
			url,
			`${type}:${checkpoint}`,
			type,
			'pending'
		);
		object.checkpointLedger = type === 'bucket' ? null : checkpoint;
		object.executionDisposition = 'executable';
		object.dependencyReady = true;
		await db.getRepository(HistoryArchiveObject).save(object);
		const executionId = published ? randomUUID() : null;
		await db.query(
			`insert into history_archive_object_ready("objectRemoteId","archiveUrlIdentity",priority,"availableAt","dispatchToken","claimAttempt","publishedAt")
      values($1,$2,$3,now(),$4,$5,$6)`,
			[
				object.remoteId,
				url,
				priority,
				executionId,
				published ? 1 : null,
				published ? new Date() : null
			]
		);
		return { object, executionId };
	}
	async function fail(
		target: Awaited<ReturnType<typeof seed>>,
		status: number | null = 404,
		message = 'remote failure',
		channel:
			| 'archive_availability'
			| 'archive_evidence'
			| 'scanner_issue' = 'archive_availability'
	) {
		return await markHistoryArchiveObjectFailed(
			db.getRepository(HistoryArchiveObject),
			target.object.remoteId,
			{
				claimAttempt: 1,
				executionId: target.executionId!,
				scheduler: 'broker',
				errorType: 'archive_http_error',
				errorMessage: message,
				failureChannel: channel,
				httpStatus: status,
				nextAttemptAt: null
			}
		);
	}
	async function control(url = root) {
		return (await db.query(
			'select * from history_archive_root_failure_control where "archiveUrlIdentity"=$1 order by scope',
			[url]
		)) as Array<{
			scope: string;
			consecutiveFailures: number;
			missingCheckpoints: string[];
			blockedUntil: Date | null;
			probeExecutionId: string | null;
			adaptiveProbeState: object | null;
			nextProbeCheckpoint: string | null;
			failureKind: string;
		}>;
	}
	async function trip(
		status = 404,
		type: HistoryArchiveObject['objectType'] = 'checkpoint-state'
	) {
		for (const checkpoint of [63, 127, 191])
			await fail(await seed(checkpoint, root, type), status);
	}
	async function reserve(limit = 8) {
		return await new HistoryArchiveBrokerFrontierRepository(db).reserveJobs(
			limit,
			8,
			2,
			null
		);
	}
	async function expire() {
		await db.query(
			`update history_archive_root_failure_control set "blockedUntil"=now()-interval '1 second',"probeLeaseUntil"=null`
		);
	}

	it('requires three distinct adjacent numbered positions, including out-of-order completions', async () => {
		for (const checkpoint of [191, 63]) await fail(await seed(checkpoint));
		expect((await control())[0]!.blockedUntil).toBeNull();
		await fail(await seed(127));
		expect((await control())[0]!.blockedUntil!.getTime()).toBeGreaterThan(
			Date.now()
		);
		expect(
			(await control())[0]!.missingCheckpoints.map(Number).sort((a, b) => a - b)
		).toEqual([63, 127, 191]);
	});
	it('does not turn sparse misses or different categories into a missing run', async () => {
		for (const checkpoint of [63, 191, 319]) await fail(await seed(checkpoint));
		await fail(await seed(127, root, 'ledger'));
		await fail(await seed(127, root, 'bucket'));
		expect((await control()).every((row) => row.blockedUntil === null)).toBe(
			true
		);
		expect(
			(await control()).find((row) => row.scope === 'bucket')!
				.missingCheckpoints
		).toEqual([]);
	});
	it('cools repeated unordered bucket misses without recording a numbered missing interval', async () => {
		for (const checkpoint of [1, 2, 3])
			await fail(await seed(checkpoint, root, 'bucket'));
		expect((await control())[0]).toMatchObject({
			scope: 'bucket',
			missingCheckpoints: []
		});
		expect((await control())[0]!.blockedUntil!.getTime()).toBeGreaterThan(
			Date.now()
		);
	});
	it('403 cooldown is authentication evidence, never missing-range evidence', async () => {
		await trip(403);
		const [row] = await control();
		expect(row).toMatchObject({ failureKind: 'auth', missingCheckpoints: [] });
		expect(row!.blockedUntil!.getTime()).toBeGreaterThan(Date.now());
	});
	it('does not increment duplicate/replayed accepted completions', async () => {
		const target = await seed(63);
		const outcomes = await Promise.all([fail(target), fail(target)]);
		expect(outcomes.sort()).toEqual([false, true]);
		expect((await control())[0]!.consecutiveFailures).toBe(1);
	});
	it('keeps unhealthy priority0 prefixes from starving healthy same-host roots and independent categories', async () => {
		await trip(503);
		for (let i = 0; i < 24; i++)
			await seed(255 + i * 64, root, 'checkpoint-state', false, 0);
		const otherRoot = await seed(63, healthy, 'checkpoint-state', false, 2);
		const otherCategory = await seed(255, root, 'ledger', false, 2);
		const jobs = await reserve();
		expect(new Set(jobs.map((job) => job.job.remoteId))).toEqual(
			new Set([otherRoot.object.remoteId, otherCategory.object.remoteId])
		);
	});
	it('leases only one half-open probe across concurrent dispatchers and retains normalhostcaps', async () => {
		await trip();
		await expire();
		for (const checkpoint of [255, 319, 383])
			await seed(checkpoint, root, 'checkpoint-state', false);
		const [first, second] = await Promise.all([reserve(), reserve()]);
		expect(first.length + second.length).toBe(1);
		expect([...first, ...second][0]!.job.allowListingDiscovery).toBe(true);
		expect((await control())[0]!.probeExecutionId).toBe(
			[...first, ...second][0]!.executionId
		);
	});
	it('does not lease a second probe after clockexpiry while the first published execution still exists', async () => {
		await trip();
		await expire();
		await seed(255, root, 'checkpoint-state', false);
		await seed(319, root, 'checkpoint-state', false);
		expect(await reserve()).toHaveLength(1);
		await db.query(
			`update history_archive_root_failure_control set "probeLeaseUntil"=now()-interval '1 second'`
		);
		expect(await reserve()).toEqual([]);
	});
	it('caches an inconclusive listing response so the next leasedprobe makes no repeated capability requests', async () => {
		await trip();
		await expire();
		const target = await seed(255, root, 'checkpoint-state', false);
		const [job] = await reserve();
		expect(job!.job.allowListingDiscovery).toBe(true);
		await markHistoryArchiveObjectFailed(
			db.getRepository(HistoryArchiveObject),
			target.object.remoteId,
			{
				claimAttempt: 1,
				executionId: job!.executionId,
				scheduler: 'broker',
				errorType: 'archive_http_error',
				errorMessage: 'HTTP404',
				failureChannel: 'archive_availability',
				httpStatus: 404,
				listingCapability: {
					status: 'inconclusive',
					observedAt: new Date().toISOString()
				}
			}
		);
		await expire();
		await seed(319, root, 'checkpoint-state', false);
		expect((await reserve())[0]!.job.allowListingDiscovery).toBe(false);
	});
	it('blocks directclaims and stale dispatcher replays but preserves the actual leasedprobe replay directive', async () => {
		const old = await seed(255);
		await trip();
		await seed(319, root, 'checkpoint-state', false);
		await db.query(
			`insert into history_archive_object_claim_slot(slot) values(0) on conflict do nothing`
		);
		const direct = await db.query(historyArchiveObjectClaimSql, [
			['checkpoint-state'],
			8,
			120,
			8
		]);
		expect(direct[0].outcome).toBe('idle');
		const broker = new HistoryArchiveBrokerFrontierRepository(db);
		expect(await broker.findPublishedJobs(8, 2, null)).toEqual([]);
		await db.query(
			'delete from history_archive_object_ready where "objectRemoteId"=$1',
			[old.object.remoteId]
		);
		await expire();
		const [probe] = await reserve();
		const replay = await broker.findPublishedJobs(8, 2, null);
		expect(replay).toHaveLength(1);
		expect(replay[0]!.executionId).toBe(probe!.executionId);
		expect(replay[0]!.job.allowListingDiscovery).toBe(true);
	});
	it('clears health cooldown without deleting planner-owned unknown intervals', async () => {
		await trip();
		await expire();
		const state = { pending: { checkpoint: 255 }, unknown: [[319, 1023]] };
		await db.query(
			`update history_archive_root_failure_control set "adaptiveProbeState"=$1,"nextProbeCheckpoint"=255`,
			[state]
		);
		const target = await seed(255);
		await db.query(historyArchiveObjectVerifiedBatchSql, [
			JSON.stringify([
				{
					remoteId: target.object.remoteId,
					claimAttempt: 1,
					executionId: target.executionId,
					scheduler: 'broker',
					hasBytesDownloaded: false,
					hasVerificationFacts: false,
					verificationFacts: null,
					archiveMetadata: null
				}
			])
		]);
		expect((await control())[0]).toMatchObject({
			consecutiveFailures: 0,
			blockedUntil: null,
			adaptiveProbeState: state,
			nextProbeCheckpoint: '255'
		});
	});
	it('does not create health rows for healthy-only roots', async () => {
		const target = await seed(63);
		await db.query(historyArchiveObjectVerifiedBatchSql, [
			JSON.stringify([
				{
					remoteId: target.object.remoteId,
					claimAttempt: 1,
					executionId: target.executionId,
					scheduler: 'broker',
					hasBytesDownloaded: false,
					hasVerificationFacts: false,
					verificationFacts: null,
					archiveMetadata: null
				}
			])
		]);
		expect(await control()).toEqual([]);
	});
	it('an old pre-cooldown success cannot reopen the category even when completed concurrently with anotherfailure', async () => {
		const old = await seed(255);
		await trip();
		const late = await seed(319);
		await Promise.all([
			db.query(historyArchiveObjectVerifiedBatchSql, [
				JSON.stringify([
					{
						remoteId: old.object.remoteId,
						claimAttempt: 1,
						executionId: old.executionId,
						scheduler: 'broker',
						hasBytesDownloaded: false,
						hasVerificationFacts: false,
						verificationFacts: null,
						archiveMetadata: null
					}
				])
			]),
			fail(late),
			reserve()
		]);
		expect((await control())[0]!.blockedUntil!.getTime()).toBeGreaterThan(
			Date.now()
		);
	});
	it('honors Retry-After on the first503 and rolls its completion/control back atomically', async () => {
		const target = await seed(63);
		await db.transaction(async (manager) => {
			await markHistoryArchiveObjectFailed(
				manager.getRepository(HistoryArchiveObject),
				target.object.remoteId,
				{
					claimAttempt: 1,
					executionId: target.executionId!,
					scheduler: 'broker',
					errorType: 'archive_http_error',
					errorMessage: 'HTTP503',
					failureChannel: 'archive_availability',
					httpStatus: 503,
					retryAfterSeconds: 900
				}
			);
		});
		expect((await control())[0]!.blockedUntil!.getTime()).toBeGreaterThan(
			Date.now() + 890_000
		);
		const rolledBack = await seed(127, healthy);
		await expect(
			db.transaction(async (manager) => {
				await markHistoryArchiveObjectFailed(
					manager.getRepository(HistoryArchiveObject),
					rolledBack.object.remoteId,
					{
						claimAttempt: 1,
						executionId: rolledBack.executionId!,
						scheduler: 'broker',
						errorType: 'archive_http_error',
						errorMessage: 'HTTP503',
						failureChannel: 'archive_availability',
						httpStatus: 503,
						retryAfterSeconds: 900
					}
				);
				throw new Error('crash before commit');
			})
		).rejects.toThrow('crash before commit');
		expect(await control(healthy)).toEqual([]);
		expect(
			(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: rolledBack.object.remoteId })
			).status
		).toBe('pending');
	});
	it('accepts genuine HTTP404 historically labeled archive_evidence but not local scanner errors', async () => {
		for (const checkpoint of [63, 127, 191])
			await fail(
				await seed(checkpoint),
				404,
				'HttpError: Request failed with status code404',
				'archive_evidence'
			);
		expect((await control())[0]!.blockedUntil!.getTime()).toBeGreaterThan(
			Date.now()
		);
	});
	it('a finished adaptive record does not hold ordinary work indefinitely', async () => {
		await trip();
		await db.query(`update history_archive_root_failure_control set "consecutiveFailures"=0,"blockedUntil"=null,
      "adaptiveProbeState"='{"version":1,"through":191,"unknown":[],"pending":null}',"nextProbeCheckpoint"=null`);
		await seed(255, root, 'checkpoint-state', false);
		expect(await reserve()).toHaveLength(1);
	});
	it('does not cool healthy sources for local shutdown/coordinator/cancellation outcomes', async () => {
		for (const [index, message] of [
			'cancelled',
			'coordinator deadline',
			'worker shutdown'
		].entries())
			await fail(await seed(63 + 64 * index), null, message, 'scanner_issue');
		expect(await control()).toEqual([]);
		await seed(255, root, 'checkpoint-state', false);
		expect(await reserve()).toHaveLength(1);
	});
	it('classifies actual DNS as root-wide, timeout as category,429 as existinghostpolicy, blank as nofault', () => {
		const base = {
			claimAttempt: 1,
			errorType: 'archive_transport_error',
			failureChannel: 'archive_availability' as const,
			errorMessage: ''
		};
		expect(
			classifyRootFailure({ ...base, errorMessage: 'getaddrinfo ENOTFOUND' })
		).toEqual({ kind: 'transient', rootWide: true });
		expect(
			classifyRootFailure({
				...base,
				errorMessage: 'request timeout ETIMEDOUT'
			})
		).toEqual({ kind: 'transient', rootWide: false });
		expect(classifyRootFailure({ ...base, httpStatus: 429 })).toBeNull();
		expect(classifyRootFailure(base)).toBeNull();
		expect(
			classifyRootFailure({ ...base, errorMessage: 'ERR_CANCELED' })
		).toBeNull();
	});
});
