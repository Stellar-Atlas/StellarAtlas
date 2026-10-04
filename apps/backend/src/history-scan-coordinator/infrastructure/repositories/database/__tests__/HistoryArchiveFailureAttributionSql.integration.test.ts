import { DataSource } from 'typeorm';
import { isHistoryArchiveInconclusiveTransportFailure } from 'shared';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveInconclusiveTransportFailureSql } from '../HistoryArchiveFailureAttributionSql.js';

jest.setTimeout(60_000);

describe('portable archive failure attribution SQL', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	it('matches JavaScript for interruptions, safe blank types, and explicit evidence', async () => {
		const inputs = [
			{
				errorType: 'HttpError',
				errorMessage: 'SB Connection time-out',
				expected: true
			},
			{ errorType: null, errorMessage: 'cancelled', expected: true },
			{
				errorType: 'archive_http_error',
				errorMessage: 'canceled',
				expected: true
			},
			{ errorType: null, errorMessage: null, expected: true },
			{ errorType: '', errorMessage: '\t\n ', expected: true },
			{ errorType: 'unknown', errorMessage: '', expected: true },
			{
				errorType: '\t HTTP-ERROR \n',
				errorMessage: '\tHttpError:\n',
				expected: true
			},
			{
				errorType: 'archive_http_error',
				httpStatus: 200,
				errorMessage: 'HttpError:',
				expected: true
			},
			{ errorType: 'worker_setup_failure', errorMessage: '', expected: false },
			{
				errorType: 'worker_configuration_error',
				errorMessage: 'HttpError:',
				expected: false
			},
			{ errorType: 'local_error', errorMessage: null, expected: false },
			{
				errorType: 'unknown',
				errorMessage: 'unexplained failure',
				expected: false
			},
			{
				errorType: 'HttpError',
				errorMessage: 'HttpError: certificate rejected',
				expected: false
			},
			{ errorType: null, errorMessage: 'uncancelled', expected: false },
			{
				errorType: 'integrity_error',
				errorMessage: 'cancelled',
				expected: false
			},
			{ errorType: 'decode_error', errorMessage: 'canceled', expected: false },
			{
				errorType: 'xdr_invalid',
				errorMessage: 'SB Connection time-out',
				expected: false
			},
			{ errorType: 'bucket_hash_mismatch', errorMessage: '', expected: false },
			...[300, 302, 404, 429, 500, 503, 599].map((httpStatus) => ({
				httpStatus,
				errorType: 'HttpError',
				errorMessage: 'cancelled',
				expected: false
			}))
		];
		const rows: Array<{
			httpStatus: number | null;
			errorType: string | null;
			errorMessage: string | null;
			expected: boolean;
			classified: boolean;
		}> = await db.query(
			`select input.*, ${historyArchiveInconclusiveTransportFailureSql('input')} as classified from jsonb_to_recordset($1::jsonb) input("httpStatus" integer, "errorType" text, "errorMessage" text, expected boolean)`,
			[JSON.stringify(inputs)]
		);
		expect(rows).toHaveLength(inputs.length);
		for (const row of rows) {
			expect({
				input: row.errorMessage,
				sql: row.classified,
				js: isHistoryArchiveInconclusiveTransportFailure(row)
			}).toEqual({
				input: row.errorMessage,
				sql: row.expected,
				js: row.expected
			});
		}
	});
	it('rejects interpolated identifiers', () => {
		expect(() =>
			historyArchiveInconclusiveTransportFailureSql('input;drop table x')
		).toThrow('Invalid failure SQL alias');
	});
});
