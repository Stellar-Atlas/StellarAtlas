import type { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import { historyArchiveObjectVerifiedBatchSql } from '../HistoryArchiveObjectLeaseWrite.js';
import { historyArchiveBrokerFirstPassIndexes } from '../HistoryArchiveBrokerFirstPassAdmissionSql.js';
import {
	historyArchiveBrokerCandidateProjectionSchemaSql,
	hydrateHistoryArchiveBrokerCandidatesSql
} from '../HistoryArchiveBrokerCandidateProjection.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	evidenceBucketHash,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const root = 'https://recovery.example/history';
const otherRoot = 'https://fresh.example/history';
const fast = buildReserveBrokerJobsSql(
	false,
	'history_archive_broker_candidate',
	'first-pass'
);
const reference = buildReserveBrokerJobsSql(
	false,
	'history_archive_object_queue',
	'first-pass'
);
type Row = { remoteId: string; priority: number; selectedOrdinal: number };

describe('bounded first-pass recovery parity', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
			priority smallint not null,"availableAt" timestamptz not null,
			"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
			"recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
		for (const sql of historyArchiveBrokerFirstPassIndexes) await db.query(sql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
		await resetKnownEvidence(db);
	});
	async function seed(
		identity: string,
		type: HistoryArchiveObject['objectType'],
		checkpoint: number | null,
		status: 'pending' | 'failed',
		attempts = 0,
		httpStatus: number | null = null
	) {
		const key =
			type === 'bucket'
				? `bucket:${evidenceBucketHash}`
				: `${type}:${checkpoint === null ? 'root' : checkpoint.toString(16).padStart(8, '0')}`;
		const object = createEvidenceObject(identity, key, type, status);
		object.checkpointLedger = checkpoint;
		object.hostIdentity = 'shared.example';
		object.executionDisposition = 'executable';
		object.dependencyReady = true;
		object.attempts = attempts;
		object.httpStatus = httpStatus;
		object.errorType = httpStatus === null ? null : 'archive_http_error';
		object.errorMessage = httpStatus === null ? null : `HTTP ${httpStatus}`;
		object.nextAttemptAt = status === 'failed' ? new Date('2000-01-01Z') : null;
		await db.getRepository(HistoryArchiveObject).save(object);
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
			values($1,$2,$3,'2000-01-01Z','2001-01-01Z')`,
			[object.remoteId, identity, attempts > 0 ? 0 : 2]
		);
		return object;
	}
	async function frontier(identity = root) {
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor
			("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values($1,191,127)`,
			[identity]
		);
	}
	async function compare(limit = 8, hostLimit = 8) {
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		return db.transaction(async (manager) => {
			await manager.query('savepoint comparison');
			const expected = (await manager.query(reference, [
				limit,
				hostLimit,
				2,
				null
			])) as Row[];
			await manager.query('rollback to savepoint comparison');
			const actual = (await manager.query(fast, [
				limit,
				hostLimit,
				2,
				null
			])) as Row[];
			const identities = (rows: Row[]) =>
				rows.map(({ remoteId, priority, selectedOrdinal }) => ({
					remoteId,
					priority,
					selectedOrdinal
				}));
			expect(identities(actual)).toEqual(identities(expected));
			return actual.map(({ remoteId }) => remoteId);
		});
	}
	it('ranks fresh work first on a shared host, admitting only an exact transient frontier recovery', async () => {
		await frontier();
		const recovery = await seed(root, 'results', 63, 'failed', 1, 503);
		await seed(root, 'ledger', 127, 'failed', 1, 503);
		await seed(root, 'transactions', 63, 'failed', 1, 404);
		await seed(otherRoot, 'results', 63, 'failed', 1, 503);
		const fresh = await seed(otherRoot, 'ledger', 63, 'pending');
		expect(await compare(8, 2)).toEqual([fresh.remoteId, recovery.remoteId]);
	});
	it('recovers the exact dependency bucket despite an older deduplicated checkpoint association', async () => {
		await frontier();
		const recovery = await seed(root, 'bucket', 999, 'failed', 1, 503);
		await seed(otherRoot, 'bucket', 63, 'failed', 1, 503);
		await db.query(
			`insert into history_archive_checkpoint_bucket_dependency
			("archiveUrlIdentity","checkpointLedger","bucketHash") values($1,63,$2)`,
			[root, evidenceBucketHash]
		);
		expect(await compare()).toEqual([recovery.remoteId]);
	});
	it('retains metadata bootstrap after an unsuccessful attempt without opening unrelated retries', async () => {
		const metadata = await seed(
			root,
			'history-archive-state',
			null,
			'failed',
			1,
			503
		);
		await seed(root, 'ledger', 63, 'failed', 1, 503);
		const fresh = await seed(otherRoot, 'ledger', 63, 'pending');
		expect(await compare()).toEqual([fresh.remoteId, metadata.remoteId]);
	});
	it('retains exact adaptive point and active lease guards inside the bounded prefix', async () => {
		await seed(root, 'checkpoint-state', 63, 'pending');
		const probe = await seed(root, 'checkpoint-state', 127, 'pending');
		await seed(root, 'checkpoint-state', 191, 'pending');
		await db.query(
			`insert into history_archive_root_failure_control
			("archiveUrlIdentity",scope,"failureKind","blockedUntil","adaptiveProbeState","nextProbeCheckpoint")
			values($1,'checkpoint-state','missing','2000-01-01Z','{"unknown":[[63,191]]}'::jsonb,127)`,
			[root]
		);
		expect(await compare()).toEqual([probe.remoteId]);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=null`
		);
		expect(await compare()).toEqual([]);
	});
	it('clears orphaned pre-switch published retries without erasing evidence or consuming fresh host slots', async () => {
		const priorPhase = process.env.HISTORY_ARCHIVE_RETRY_PHASE;
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'first-pass';
		try {
			const old404 = await seed(root, 'ledger', 63, 'failed', 1, 404);
			const old503 = await seed(root, 'results', 63, 'failed', 1, 503);
			const fresh = await seed(otherRoot, 'ledger', 63, 'pending');
			await db.query(
				`update history_archive_object_ready set "publishedAt"='2000-01-01Z',
				"dispatchToken"=gen_random_uuid(),"claimAttempt"=2 where "objectRemoteId"=any($1::uuid[])`,
				[[old404.remoteId, old503.remoteId]]
			);
			const broker = new HistoryArchiveBrokerFrontierRepository(db);
			expect(await broker.findPublishedJobs(8)).toEqual([]);
			expect(await compare(8, 2)).toEqual([]);
			// The dispatcher may invoke this only after confirming that NATS is empty.
			expect(await broker.requeueOrphanedPublishedJobs(new Date(), 8)).toBe(2);
			expect(await compare(8, 2)).toEqual([fresh.remoteId]);
			const rows = await db.query(
				`select status,attempts,"httpStatus","errorMessage"
				from history_archive_object_queue where "remoteId"=any($1::uuid[]) order by "httpStatus"`,
				[[old404.remoteId, old503.remoteId]]
			);
			expect(rows).toEqual([
				{
					status: 'failed',
					attempts: 1,
					httpStatus: 404,
					errorMessage: 'HTTP 404'
				},
				{
					status: 'failed',
					attempts: 1,
					httpStatus: 503,
					errorMessage: 'HTTP 503'
				}
			]);
		} finally {
			if (priorPhase === undefined)
				delete process.env.HISTORY_ARCHIVE_RETRY_PHASE;
			else process.env.HISTORY_ARCHIVE_RETRY_PHASE = priorPhase;
		}
	});
	it('accepts a pre-switch in-flight completion only through its original execution fence', async () => {
		const object = await seed(root, 'ledger', 63, 'failed', 1, 503);
		const token = randomUUID();
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now(),
			"dispatchToken"=$1,"claimAttempt"=2 where "objectRemoteId"=$2`,
			[token, object.remoteId]
		);
		const completion = {
			remoteId: object.remoteId,
			scheduler: 'broker',
			claimAttempt: 2,
			executionId: randomUUID(),
			hasBytesDownloaded: false,
			hasVerificationFacts: false
		};
		expect(
			await db.query(historyArchiveObjectVerifiedBatchSql, [
				JSON.stringify([completion])
			])
		).toEqual([]);
		const accepted = await db.query(historyArchiveObjectVerifiedBatchSql, [
			JSON.stringify([{ ...completion, executionId: token }])
		]);
		expect(accepted).toEqual([
			expect.objectContaining({ remoteId: object.remoteId })
		]);
		expect(
			await db.query(
				'select status,attempts from history_archive_object_queue where "remoteId"=$1',
				[object.remoteId]
			)
		).toEqual([{ status: 'verified', attempts: 2 }]);
	});
});
