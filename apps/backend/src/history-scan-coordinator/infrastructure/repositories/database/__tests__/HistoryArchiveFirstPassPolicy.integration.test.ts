import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	getHistoryArchiveRetryPhase,
	historyArchiveFirstPassAllowedSql,
	type HistoryArchiveRetryPhase
} from '../HistoryArchiveFirstPassPolicy.js';
import { admitDailyTransientSourceRetries } from '../HistoryArchiveTransientSourceRetry.js';

jest.setTimeout(60_000);
const root = 'https://first-pass.example';
interface Candidate {
	remoteId: string;
	archiveUrlIdentity: string;
	status: string;
	attempts: number;
	objectType: string;
	checkpointLedger: number | null;
	httpStatus: number | null;
	errorType: string | null;
	errorMessage: string | null;
	dependencyReady: boolean;
	executionDisposition: string;
}
const candidate = (changes: Partial<Candidate> = {}): Candidate => ({
	remoteId: randomUUID(),
	archiveUrlIdentity: root,
	status: 'failed',
	attempts: 1,
	objectType: 'results',
	checkpointLedger: 63,
	httpStatus: 503,
	errorType: 'archive_http_error',
	errorMessage: 'Service unavailable',
	dependencyReady: true,
	executionDisposition: 'executable',
	...changes
});

describe('first-pass retry policy with real PostgreSQL', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
		await db.query(`
			create table history_archive_checkpoint_scan_cursor ("archiveUrlIdentity" text primary key, "nextHistoricalCheckpointLedger" integer);
			create table history_archive_checkpoint_proof ("archiveUrlIdentity" text, "checkpointLedger" integer, status text);
			create table history_archive_checkpoint_substitution ("archiveUrlIdentity" text, "checkpointLedger" integer);
			create table history_archive_object_queue ("remoteId" uuid primary key, "bucketHash" text, "dependenciesMaterializedAt" timestamptz, "verifiedAt" timestamptz);
			create table history_archive_checkpoint_content_observation ("archiveUrlIdentity" text, "checkpointLedger" integer, "contentDigest" text, "checkpointStateObjectRemoteId" uuid, "createdAt" timestamptz);
			create table history_archive_checkpoint_content ("contentDigest" text primary key, "bucketSetDigest" text);
			create table history_archive_checkpoint_bucket_set_member ("bucketSetDigest" text, "bucketHash" text);
			create table history_archive_checkpoint_bucket_dependency ("archiveUrlIdentity" text, "checkpointLedger" integer, "bucketHash" text, "createdAt" timestamptz);
		`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(`truncate history_archive_checkpoint_scan_cursor,
			history_archive_checkpoint_proof, history_archive_checkpoint_substitution,
			history_archive_object_queue, history_archive_checkpoint_bucket_dependency`);
	});
	async function allowed(
		object: Candidate,
		manual: {
			recheckRequestedAt?: string;
			dispatchToken?: string;
			claimAttempt?: number;
		} = {},
		phase: HistoryArchiveRetryPhase = 'first-pass'
	): Promise<boolean> {
		const [row] = await db.query(
			`select ${historyArchiveFirstPassAllowedSql('object', 'ready', phase)} as allowed
			from jsonb_to_record($1::jsonb) as object("remoteId" uuid, "archiveUrlIdentity" text,
			status text, attempts integer, "objectType" text, "checkpointLedger" integer,
			"httpStatus" integer, "errorType" text, "errorMessage" text,
			"dependencyReady" boolean, "executionDisposition" text)
			cross join jsonb_to_record($2::jsonb) as ready("recheckRequestedAt" timestamptz,
			"dispatchToken" uuid, "claimAttempt" integer)`,
			[JSON.stringify(object), JSON.stringify(manual)]
		);
		return row.allowed === true;
	}
	async function openFrontier(identity = root): Promise<void> {
		await db.query(
			'insert into history_archive_checkpoint_scan_cursor values($1,127)',
			[identity]
		);
	}

	it('defaults explicitly to first-pass without pretending coverage is complete', () => {
		expect(getHistoryArchiveRetryPhase({})).toBe('first-pass');
		expect(
			getHistoryArchiveRetryPhase({ HISTORY_ARCHIVE_RETRY_PHASE: 'recheck' })
		).toBe('recheck');
		expect(() =>
			getHistoryArchiveRetryPhase({ HISTORY_ARCHIVE_RETRY_PHASE: 'automatic' })
		).toThrow();
	});
	it('admits never-attempted work but not requeued pending retries or old 503s', async () => {
		expect(
			await allowed(
				candidate({ status: 'pending', attempts: 0, httpStatus: null })
			)
		).toBe(true);
		expect(await allowed(candidate({ status: 'pending' }))).toBe(false);
		expect(await allowed(candidate())).toBe(false);
	});
	it('keeps metadata bootstrap and refresh available when the head is unknown', async () => {
		expect(
			await allowed(
				candidate({
					objectType: 'history-archive-state',
					checkpointLedger: null
				})
			)
		).toBe(true);
	});
	it('allows an explicit unconsumed manual request but not an ambiguous or consumed token', async () => {
		const object = candidate({ httpStatus: 404 });
		const request = {
			recheckRequestedAt: new Date().toISOString(),
			dispatchToken: randomUUID()
		};
		expect(await allowed(object, request)).toBe(true);
		expect(
			await allowed(object, { dispatchToken: request.dispatchToken })
		).toBe(false);
		expect(
			await allowed(object, { ...request, claimAttempt: object.attempts })
		).toBe(false);
	});
	it('recovers only a transient at the exact blocked frontier and never definitive 404', async () => {
		await openFrontier();
		expect(await allowed(candidate())).toBe(true);
		expect(await allowed(candidate({ checkpointLedger: 127 }))).toBe(false);
		expect(
			await allowed(candidate({ archiveUrlIdentity: 'https://other.example' }))
		).toBe(false);
		expect(await allowed(candidate({ httpStatus: 404 }))).toBe(false);
		expect(
			await allowed(
				candidate({
					httpStatus: null,
					errorType: 'archive_transport_error',
					errorMessage: 'interrupted ECONNRESET'
				})
			)
		).toBe(true);
		expect(
			await allowed(
				candidate({
					httpStatus: null,
					errorType: 'hash_mismatch',
					errorMessage: 'wrong content hash'
				})
			)
		).toBe(false);
	});
	it('does not repeat a dependency after proof or substitution has already unblocked the frontier', async () => {
		await openFrontier();
		await db.query(
			"insert into history_archive_checkpoint_proof values($1,63,'verified')",
			[root]
		);
		expect(await allowed(candidate())).toBe(false);
		await db.query('truncate history_archive_checkpoint_proof');
		await db.query(
			'insert into history_archive_checkpoint_substitution values($1,63)',
			[root]
		);
		expect(await allowed(candidate())).toBe(false);
	});
	it('uses exact bucket membership, not a deduplicated bucket old checkpoint association', async () => {
		await openFrontier();
		const object = candidate({ objectType: 'bucket', checkpointLedger: 999 });
		await db.query(
			'insert into history_archive_object_queue("remoteId","bucketHash") values($1,\'bucket-a\')',
			[object.remoteId]
		);
		await db.query(
			"insert into history_archive_checkpoint_bucket_dependency values($1,63,'bucket-a',now())",
			[root]
		);
		expect(await allowed(object)).toBe(true);
		await db.query('truncate history_archive_checkpoint_bucket_dependency');
		expect(await allowed(object)).toBe(false);
	});
	it('reopens both 503 and 404 only in the explicit recheck phase without changing evidence', async () => {
		for (const httpStatus of [404, 503]) {
			const object = candidate({ httpStatus });
			const before = JSON.stringify(object);
			expect(await allowed(object, {}, 'recheck')).toBe(true);
			expect(JSON.stringify(object)).toBe(before);
		}
	});
	it('does not scan or write the retry sweep during first-pass', async () => {
		const prior = process.env.HISTORY_ARCHIVE_RETRY_PHASE;
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'first-pass';
		try {
			// No sweep table exists in this database: any maintenance query would fail.
			expect(await admitDailyTransientSourceRetries(db.manager, 128)).toBe(0);
		} finally {
			if (prior === undefined) delete process.env.HISTORY_ARCHIVE_RETRY_PHASE;
			else process.env.HISTORY_ARCHIVE_RETRY_PHASE = prior;
		}
	});
});
