import { mock, type MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	GetHistoryArchiveBucketCoverage,
	InvalidBucketHashError
} from '../GetHistoryArchiveBucketCoverage.js';

const bucketHash =
	'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

describe('GetHistoryArchiveBucketCoverage', () => {
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let repository: MockProxy<HistoryArchiveObjectRepository>;

	beforeEach(() => {
		exceptionLogger = mock<ExceptionLogger>();
		repository = mock<HistoryArchiveObjectRepository>();
	});

	it('groups bucket copies by current queue status', async () => {
		repository.findBucketObjectsByHash.mockResolvedValue([
			createBucketObject('https://history-a.example.com', 'verified'),
			createBucketObject('https://history-b.example.com', 'failed', {
				errorMessage:
					'Failed to read /home/observe/stellarbeat-data/Observer/history-bucket-cache/a/b',
				errorType: 'worker_io_error'
			}),
			createBucketObject('https://history-c.example.com', 'pending'),
			createBucketObject('https://history-d.example.com', 'scanning', {
				workerStage: 'downloading_bucket'
			})
		]);

		const result = await createUseCase().execute(bucketHash.toUpperCase());

		expect(result.isOk()).toBe(true);
		expect(repository.findBucketObjectsByHash).toHaveBeenCalledWith(bucketHash);
		expect(result._unsafeUnwrap()).toMatchObject({
			bucketHash,
			counts: {
				archiveRoots: 4,
				failedCopies: 1,
				pendingCopies: 1,
				scanningCopies: 1,
				totalCopies: 4,
				verifiedCopies: 1
			},
			archiveRoots: [
				{ archiveUrl: 'https://history-a.example.com', status: 'verified' },
				{ archiveUrl: 'https://history-b.example.com', status: 'failed' },
				{ archiveUrl: 'https://history-c.example.com', status: 'pending' },
				{ archiveUrl: 'https://history-d.example.com', status: 'scanning' }
			],
			failedCopies: [
				{
					error: {
						message: 'Failed to read [history bucket cache path]',
						type: 'worker_io_error'
					}
				}
			],
			scanningCopies: [{ workerStage: 'downloading_bucket' }]
		});
	});

	it('rejects invalid bucket hashes', async () => {
		const result = await createUseCase().execute('not-a-bucket-hash');

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(InvalidBucketHashError);
		expect(repository.findBucketObjectsByHash).not.toHaveBeenCalled();
	});

	function createUseCase(): GetHistoryArchiveBucketCoverage {
		return new GetHistoryArchiveBucketCoverage(repository, exceptionLogger);
	}
});

function createBucketObject(
	archiveUrl: string,
	status: HistoryArchiveObject['status'],
	options: {
		readonly errorMessage?: string;
		readonly errorType?: string;
		readonly workerStage?: string;
	} = {}
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/4e/ae/73/bucket-${bucketHash}.xdr.gz`,
		status
	});
	object.attempts = status === 'pending' ? 0 : 1;
	object.errorMessage = options.errorMessage ?? null;
	object.errorType = options.errorType ?? null;
	object.httpStatus = null;
	object.workerStage = options.workerStage ?? null;
	object.verifiedAt =
		status === 'verified' ? new Date('2026-07-06T16:00:00.000Z') : null;
	(object as HistoryArchiveObject & { updatedAt?: Date }).updatedAt = new Date(
		'2026-07-06T16:05:00.000Z'
	);

	return object;
}
