import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';

jest.setTimeout(60_000);

const archiveUrl = 'https://target.example.com';

describe('history archive actionable object query', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveObject],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.getRepository(HistoryArchiveObject).clear();
	});

	it('filters infrastructure and transient failures before applying the limit', async () => {
		const worker = failure('ledger', 'worker', 1);
		worker.failureChannel = 'scanner_issue';
		worker.errorType = 'WORKER_EACCES';
		const transport = failure('results', 'transport', 2);
		transport.failureChannel = 'archive_evidence';
		transport.errorType = 'ECONNRESET';
		const missing = failure('transactions', 'missing', 3);
		missing.failureChannel = 'archive_evidence';
		missing.errorType = 'archive_http_error';
		missing.httpStatus = 404;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([worker, transport, missing]);

		await expect(
			repository.findActionableByArchiveUrl(archiveUrl, 1)
		).resolves.toEqual([
			expect.objectContaining({ remoteId: missing.remoteId })
		]);
	});

	it('keeps archive hash failures but excludes aborted work', async () => {
		const mismatch = failure('bucket', 'mismatch', 1);
		mismatch.bucketHash = 'a'.repeat(64);
		mismatch.failureChannel = 'archive_evidence';
		mismatch.errorType = 'HASH_MISMATCH';
		const aborted = failure('bucket', 'aborted', 2);
		aborted.bucketHash = 'b'.repeat(64);
		aborted.failureChannel = 'archive_evidence';
		aborted.errorType = 'bucket_verification_failed';
		aborted.errorMessage = 'Download aborted by scanner shutdown';
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([mismatch, aborted]);

		await expect(
			repository.findActionableByArchiveUrl(archiveUrl, 10)
		).resolves.toEqual([
			expect.objectContaining({ remoteId: mismatch.remoteId })
		]);
	});
});

function failure(
	objectType: HistoryArchiveObject['objectType'],
	key: string,
	objectOrder: number
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: 63,
		objectKey: `${objectType}:${key}`,
		objectOrder,
		objectType,
		objectUrl: `${archiveUrl}/${objectType}/${key}`,
		status: 'failed'
	});
}
