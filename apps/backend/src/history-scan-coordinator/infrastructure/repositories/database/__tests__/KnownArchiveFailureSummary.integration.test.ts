import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	queryKnownArchiveFailureSummary,
	knownArchiveFailureSummarySql
} from '../KnownArchiveFailureSummaryQuery.js';
import { getKnownArchiveFailureSummary } from '../KnownArchiveFailureSummaryCache.js';
import { isHistoryArchiveInconclusiveTransportFailure } from 'shared';
import { historyArchiveInconclusiveTransportFailureSql } from '../HistoryArchiveFailureAttributionSql.js';

jest.setTimeout(60_000);
const root = 'https://archive.example/Case';
describe('root-specific exact unresolved source reasons', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
		await db.query(`
			create table history_archive_object_queue (
				"archiveUrlIdentity" text, "objectType" text, status text,
				"failureChannel" text, "errorType" text, "errorMessage" text, "httpStatus" integer,
				"remoteId" uuid default gen_random_uuid() unique, "checkpointLedger" integer default 63
			);
			create index fixture_root_status on history_archive_object_queue ("archiveUrlIdentity", status);
			create table history_archive_retained_remote_finding (
				"archiveUrlIdentity" text, "objectType" text, "failureChannel" text,
				"errorType" text, "errorMessage" text, "httpStatus" integer, "retainedOnly" boolean,
				"objectRemoteId" uuid
			);
			create index fixture_retained_root on history_archive_retained_remote_finding ("archiveUrlIdentity") where "retainedOnly";
			create table history_archive_evidence_root_summary (
				"archiveUrlIdentity" text primary key, "remoteFailureObjects" bigint, "workerIssueObjects" bigint
			);
			create table history_archive_retained_remote_summary (
				"archiveUrlIdentity" text, "retainedObjects" bigint
			);
		`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_queue, history_archive_retained_remote_finding, history_archive_evidence_root_summary, history_archive_retained_remote_summary'
		);
		await db.query(
			`
			insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","errorType","errorMessage","httpStatus")
			select $1, 'checkpoint-state', 'failed', 'archive_availability', 'archive_http_error', 'HTTP 404 Not Found', 404 from generate_series(1,40);
		`,
			[root]
		);
		await db.query(
			`insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","errorType","errorMessage","httpStatus")
			select $1, 'ledger', 'failed', 'archive_evidence', 'decode_error', 'Exact reason ' || i, null from generate_series(1,25) i`,
			[root]
		);
		await db.query(
			`insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","errorType","errorMessage","httpStatus")
			select $1, 'bucket', 'failed', 'scanner_issue', 'local_error', 'Current local failure ' || i, null from generate_series(1,300) i`,
			[root]
		);
		await db.query(
			`insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","errorType","errorMessage","httpStatus") values
			($1, 'ledger', 'verified', 'archive_evidence', 'old_error', 'Resolved', 404),
			($2, 'ledger', 'failed', 'archive_evidence', 'other_root', 'Other root', 403)`,
			[root, root.toLowerCase()]
		);
		await db.query(
			`insert into history_archive_retained_remote_finding ("archiveUrlIdentity","objectType","failureChannel","errorType","errorMessage","httpStatus","retainedOnly") values
			($1, 'checkpoint-state', 'archive_availability', 'archive_http_error', 'HTTP 404 Not Found', 404, true),
			($1, 'checkpoint-state', 'archive_availability', 'archive_http_error', 'HTTP 404 Not Found', 404, false)`,
			[root]
		);
		await db.query(
			'insert into history_archive_evidence_root_summary values ($1,65,300)',
			[root]
		);
		await db.query(
			'insert into history_archive_retained_remote_summary values ($1,1)',
			[root]
		);
	});
	it('counts every source finding, preserves exact reasons, separates worker issues and caps only groups', async () => {
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary).toMatchObject({
			status: 'current',
			computedAt: expect.any(String),
			remoteFailureCount: 66,
			workerIssueCount: 300,
			totalGroups: 26,
			remainingGroupCount: 6,
			remainingFailureCount: 6,
			limit: 20
		});
		expect(summary.groups).toHaveLength(20);
		expect(summary.groups[0]).toEqual({
			attribution: 'archive_fault',
			objectType: 'checkpoint-state',
			failureChannel: 'archive_availability',
			errorType: 'archive_http_error',
			errorMessage: 'HTTP 404 Not Found',
			httpStatus: 404,
			count: 41,
			knownAffectedCheckpointCount: 1,
			inconclusiveAffectedCheckpointCount: 0,
			unknownCheckpointFailureCount: 1
		});
		expect(
			summary.groups.every(
				(group) =>
					group.errorMessage !== 'Other root' &&
					!group.errorMessage?.startsWith('Current local failure')
			)
		).toBe(true);
		expect(
			summary.groups.reduce((sum, group) => sum + group.count, 0) +
				(summary.remainingFailureCount ?? 0)
		).toBe(66);
	});
	it('coalesces requests across request-scoped repository lifetimes with no per-page regrouping', async () => {
		const queries = jest.spyOn(db.logger, 'logQuery');
		const summaries = await Promise.all([
			getKnownArchiveFailureSummary(db, root),
			getKnownArchiveFailureSummary(db, root)
		]);
		expect(await getKnownArchiveFailureSummary(db, root)).toEqual(summaries[0]);
		expect(
			queries.mock.calls.filter(
				([sql]) => sql === knownArchiveFailureSummarySql
			)
		).toHaveLength(1);
		expect(queries.mock.calls.map(([sql]) => sql)).toEqual(
			expect.arrayContaining([
				'set transaction read only',
				"set local statement_timeout = '3s'"
			])
		);
		queries.mockRestore();
	});
	it('does not publish inconsistent rollups as complete exact counts', async () => {
		await db.query(
			'update history_archive_evidence_root_summary set "remoteFailureObjects" = 64 where "archiveUrlIdentity" = $1',
			[root]
		);
		await expect(queryKnownArchiveFailureSummary(db, root)).rejects.toThrow(
			'rollup is inconsistent'
		);
	});
	it('redacts internal paths without merging distinct recorded reasons', async () => {
		await db.query(
			`update history_archive_object_queue set "errorMessage" = 'Failed /home/private/one' where "errorType" = 'archive_http_error'`
		);
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary.groups[0]?.errorMessage).toBe('Failed [internal path]');
	});
	it('deduplicates checkpoint positions across categories and resolves retained metadata by its exact object key', async () => {
		await db.query(`update history_archive_object_queue set "checkpointLedger"=127 where "errorType"='decode_error';
			update history_archive_object_queue set "checkpointLedger"=191 where status='verified';
			update history_archive_retained_remote_finding set "objectRemoteId"=(select "remoteId" from history_archive_object_queue where status='verified') where "retainedOnly"`);
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary.knownAffectedCheckpointCount).toBe(3);
		expect(summary.unknownCheckpointFailureCount).toBe(0);
		expect(summary.groups[0]).toMatchObject({
			count: 41,
			knownAffectedCheckpointCount: 2,
			unknownCheckpointFailureCount: 0
		});
	});
	it('does not treat a bucket origin checkpoint as complete attribution or invent pruned metadata', async () => {
		await db.query(
			`update history_archive_object_queue set "objectType"='bucket' where "errorType"='archive_http_error'`
		);
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary.knownAffectedCheckpointCount).toBe(1);
		expect(summary.unknownCheckpointFailureCount).toBe(41);
	});

	it('separates incomplete HTTP200 and reset checks without losing raw evidence or explicit HTTP/content faults', async () => {
		await db.query(
			'truncate history_archive_object_queue, history_archive_retained_remote_finding, history_archive_evidence_root_summary, history_archive_retained_remote_summary'
		);
		const inputs = [
			{
				httpStatus: 404,
				errorType: 'archive_transport_error',
				errorMessage: 'aborted',
				checkpointLedger: 63
			},
			{
				httpStatus: 200,
				errorType: 'bucket_hash_mismatch',
				errorMessage: 'aborted',
				checkpointLedger: 127
			},
			{
				httpStatus: 504,
				errorType: 'ETIMEDOUT',
				errorMessage: 'gateway timeout',
				checkpointLedger: 191
			},
			{
				httpStatus: 200,
				errorType: 'archive_transport_error',
				errorMessage: 'aborted',
				checkpointLedger: 255
			},
			{
				httpStatus: null,
				errorType: 'ERR_CANCELED',
				errorMessage: 'request canceled',
				checkpointLedger: 319
			},
			{
				httpStatus: null,
				errorType: 'archive_http_error',
				errorMessage: 'ECONNRESET',
				checkpointLedger: 255
			},
			{
				httpStatus: null,
				errorType: null,
				errorMessage: 'connection timed out',
				checkpointLedger: 383
			}
		];
		await db.query(
			`insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","httpStatus","errorType","errorMessage","checkpointLedger")
			select $1,'ledger','failed','archive_availability',"httpStatus","errorType","errorMessage","checkpointLedger"
			from jsonb_to_recordset($2::jsonb) as input("httpStatus" integer,"errorType" text,"errorMessage" text,"checkpointLedger" integer)`,
			[root, JSON.stringify(inputs)]
		);
		await db.query(
			'insert into history_archive_evidence_root_summary values ($1,7,0)',
			[root]
		);
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary).toMatchObject({
			attributionVersion: 1,
			remoteFailureCount: 7,
			archiveFaultCount: 3,
			inconclusiveFailureCount: 4,
			knownAffectedCheckpointCount: 3,
			inconclusiveAffectedCheckpointCount: 3
		});
		expect(
			summary.groups.filter((group) => group.attribution === 'archive_fault')
		).toHaveLength(3);
		expect(
			summary.groups.find((group) => group.errorType === 'ERR_CANCELED')
		).toMatchObject({
			attribution: 'inconclusive',
			errorMessage: 'request canceled',
			knownAffectedCheckpointCount: 0
		});
		const rows = await db.query(
			`select input.*, ${historyArchiveInconclusiveTransportFailureSql('input')} as classified
			from jsonb_to_recordset($1::jsonb) input("httpStatus" integer,"errorType" text,"errorMessage" text,"checkpointLedger" integer)`,
			[JSON.stringify(inputs)]
		);
		for (const row of rows)
			expect(row.classified).toBe(
				isHistoryArchiveInconclusiveTransportFailure(row)
			);
		expect(
			(
				await db.query(
					'select count(*)::integer as count from history_archive_object_queue'
				)
			)[0].count
		).toBe(7);
	});

	it('does not let numerous inconclusive checks crowd confirmed reasons out of the capped page', async () => {
		await db.query(
			`insert into history_archive_object_queue ("archiveUrlIdentity","objectType",status,"failureChannel","errorType","errorMessage","httpStatus")
			select $1,'ledger','failed','archive_availability','archive_transport_error','aborted',200 from generate_series(1,100)`,
			[root]
		);
		await db.query(
			'update history_archive_evidence_root_summary set "remoteFailureObjects"=165 where "archiveUrlIdentity"=$1',
			[root]
		);
		const summary = await queryKnownArchiveFailureSummary(db, root);
		expect(summary).toMatchObject({
			archiveFaultCount: 66,
			inconclusiveFailureCount: 100,
			remoteFailureCount: 166,
			remainingFailureCount: 106
		});
		expect(
			summary.groups.every((group) => group.attribution === 'archive_fault')
		).toBe(true);
	});
});
