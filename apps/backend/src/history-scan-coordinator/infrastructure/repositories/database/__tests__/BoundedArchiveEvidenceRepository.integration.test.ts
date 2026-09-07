import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { KnownArchiveEvidenceQuery } from '../../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmKnownArchiveEvidenceRepository } from '../TypeOrmKnownArchiveEvidenceRepository.js';
import { knownArchiveFailurePageSql } from '../KnownArchiveFailurePageQuery.js';
import { knownArchiveObjectPageSql } from '../KnownArchiveObjectPageQuery.js';
import { knownArchiveObjectEventPageKeysSql } from '../KnownArchiveObjectEventPageQuery.js';
import { knownArchiveFailureSummarySql } from '../KnownArchiveFailureSummaryQuery.js';
import {
	createKnownEvidenceDataSource,
	resetKnownEvidence,
	createEvidenceObject,
	evidenceRootA as root
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);

function request(): KnownArchiveEvidenceQuery {
	const snapshotAt = new Date('2027-07-10T01:00:00.000Z');
	const page = { before: null, limit: 0, snapshotAt, snapshotTotal: 0 };
	const filters = { archiveUrlIdentity: null, objectType: null };
	return {
		roots: [{ archiveUrl: root, archiveUrlIdentity: root }],
		copyLimit: 1,
		sameOrganizationArchiveUrlIdentities: [root],
		snapshotAt,
		remoteFailures: { ...page, filters },
		workerIssues: { ...page, filters },
		objectPage: { ...page, filters: { ...filters, status: 'pending' } },
		eventPage: {
			...page,
			filters: { ...filters, eventType: null, evidenceClass: null }
		}
	};
}

describe('one bounded transaction per rooted evidence snapshot', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.destroy();
		db.setOptions({
			dropSchema: false,
			synchronize: false,
			extra: { max: 1, connectionTimeoutMillis: 1000 }
		});
		await db.initialize();
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await resetKnownEvidence(db);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	function traceQueries() {
		// The real query-runner logger includes BEGIN/COMMIT/SET and hydration,
		// not just queries invoked through the default EntityManager.
		const spy = jest.spyOn(db.logger, 'logQuery');
		return () => spy.mock.calls.map(([sql]) => sql);
	}

	function expectOneTransaction(statements: readonly string[]) {
		expect(
			statements.filter((sql) => sql === 'START TRANSACTION')
		).toHaveLength(1);
		expect(statements.filter((sql) => sql === 'COMMIT')).toHaveLength(1);
		expect(
			statements.filter(
				(sql) => sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'
			)
		).toHaveLength(1);
		expect(
			statements.filter((sql) => sql.startsWith('set transaction read only;'))
		).toEqual([
			"set transaction read only; set local statement_timeout = '5s'; set local lock_timeout = '250ms'"
		]);
		expect(statements.some((sql) => /SAVEPOINT|ROLLBACK/.test(sql))).toBe(
			false
		);
	}

	function expectNoPageQueries(statements: readonly string[]) {
		expect(statements).not.toContain(knownArchiveFailurePageSql('remote'));
		expect(statements).not.toContain(
			knownArchiveFailurePageSql('infrastructure')
		);
		expect(statements).not.toContain(knownArchiveObjectPageSql);
		expect(statements).not.toContain(knownArchiveObjectEventPageKeysSql);
	}

	it('does no database work when no roots were requested', async () => {
		const queries = traceQueries();
		const evidence = await new TypeOrmKnownArchiveEvidenceRepository(
			db
		).findEvidence({ ...request(), roots: [] });
		expect(evidence.roots).toEqual([]);
		expect(queries()).toEqual([]);
	});

	it('uses only the required root transaction when every HTTP-normalized page is disabled', async () => {
		await db
			.getRepository(HistoryArchiveObject)
			.save(createEvidenceObject(root, 'ledger:0000003f', 'ledger', 'pending'));
		const queries = traceQueries();
		const evidence = await new TypeOrmKnownArchiveEvidenceRepository(
			db
		).findEvidence(request());
		expectOneTransaction(queries());
		expectNoPageQueries(queries());
		expect(queries()).toHaveLength(9); // four controls + four root reads + state read
		expect(evidence.roots[0]?.objects.pendingObjects).toBe(1);
		expect(evidence.objectPage).toEqual({ objects: [], total: 0 });
		expect(evidence.copyCoverage).toEqual([]);
	});

	it('skips known-empty positive-limit pages and never hydrates a zero-limit sentinel row', async () => {
		await db
			.getRepository(HistoryArchiveObject)
			.save(createEvidenceObject(root, 'ledger:0000003f', 'ledger', 'pending'));
		const input = request();
		const queries = traceQueries();
		const evidence = await new TypeOrmKnownArchiveEvidenceRepository(
			db
		).findEvidence({
			...input,
			remoteFailures: { ...input.remoteFailures, limit: 10 },
			workerIssues: { ...input.workerIssues, limit: 10 },
			objectPage: { ...input.objectPage, limit: 0, snapshotTotal: 1 },
			eventPage: { ...input.eventPage, limit: 10 }
		});
		expectOneTransaction(queries());
		expectNoPageQueries(queries());
		expect(queries()).toHaveLength(9);
		expect(evidence.objectPage).toEqual({ objects: [], total: 1 });
	});

	it('shares one snapshot across mixed requested pages and preserves aggregate totals', async () => {
		const failure = createEvidenceObject(
			root,
			'ledger:0000003f',
			'ledger',
			'failed'
		);
		failure.failureChannel = 'archive_availability';
		failure.errorType = 'archive_http_error';
		failure.httpStatus = 404;
		const pending = createEvidenceObject(
			root,
			'ledger:0000007f',
			'ledger',
			'pending'
		);
		await db.getRepository(HistoryArchiveObject).save([failure, pending]);
		const input = request();
		const queries = traceQueries();
		const evidence = await new TypeOrmKnownArchiveEvidenceRepository(
			db
		).findEvidence({
			...input,
			remoteFailures: {
				...input.remoteFailures,
				limit: 1,
				snapshotTotal: null
			},
			objectPage: { ...input.objectPage, limit: 1, snapshotTotal: null }
		});
		expectOneTransaction(queries());
		expect(
			queries().filter((sql) => sql === knownArchiveFailurePageSql('remote'))
		).toHaveLength(1);
		expect(
			queries().filter((sql) => sql === knownArchiveObjectPageSql)
		).toHaveLength(1);
		expect(queries()).not.toContain(knownArchiveObjectEventPageKeysSql);
		expect(evidence.remoteFailures.total).toBe(1);
		expect(evidence.remoteFailures.failures[0]?.object.remoteId).toBe(
			failure.remoteId
		);
		expect(evidence.objectPage.total).toBe(1);
		expect(evidence.objectPage.objects[0]?.remoteId).toBe(pending.remoteId);
	});

	it('releases the only pooled connection before the independent summary cache refresh', async () => {
		const queries = traceQueries();
		const evidence = await new TypeOrmKnownArchiveEvidenceRepository(
			db
		).findEvidence({ ...request(), includeFailureSummary: true });
		expect(evidence.roots[0]?.failureSummary?.status).toBe('current');
		const statements = queries();
		expect(
			statements.filter((sql) => sql === 'START TRANSACTION')
		).toHaveLength(2);
		expect(statements.indexOf('COMMIT')).toBeLessThan(
			statements.indexOf(knownArchiveFailureSummarySql)
		);
		expectNoPageQueries(statements);
	});
});
