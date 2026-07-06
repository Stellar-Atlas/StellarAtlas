import { mock, type MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { InvalidUrlError } from '../../get-latest-scan/InvalidUrlError.js';
import { GetHistoryArchiveObjectSummary } from '../GetHistoryArchiveObjectSummary.js';

describe('GetHistoryArchiveObjectSummary', () => {
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let repository: MockProxy<HistoryArchiveObjectRepository>;

	beforeEach(() => {
		exceptionLogger = mock<ExceptionLogger>();
		repository = mock<HistoryArchiveObjectRepository>();
	});

	it('loads global object summary', async () => {
		repository.getSummary.mockResolvedValue(createSummary({ scope: 'global' }));

		const result = await createUseCase().execute();

		expect(result.isOk()).toBe(true);
		expect(repository.getSummary).toHaveBeenCalledWith({
			archiveUrl: null,
			archiveUrlIdentity: null
		});
	});

	it('normalizes archive URL identity for scoped object summary', async () => {
		repository.getSummary.mockResolvedValue(
			createSummary({
				archiveUrl: 'https://history.example.com/archive/',
				archiveUrlIdentity: 'https://history.example.com/archive',
				scope: 'archive'
			})
		);

		const result = await createUseCase().execute({
			url: 'https://history.example.com/archive/'
		});

		expect(result.isOk()).toBe(true);
		expect(repository.getSummary).toHaveBeenCalledWith({
			archiveUrl: 'https://history.example.com/archive/',
			archiveUrlIdentity: 'https://history.example.com/archive'
		});
	});

	it('rejects invalid archive URLs', async () => {
		const result = await createUseCase().execute({ url: 'not a url' });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(InvalidUrlError);
		expect(repository.getSummary).not.toHaveBeenCalled();
	});

	function createUseCase(): GetHistoryArchiveObjectSummary {
		return new GetHistoryArchiveObjectSummary(repository, exceptionLogger);
	}
});

function createSummary(options: {
	readonly archiveUrl?: string | null;
	readonly archiveUrlIdentity?: string | null;
	readonly scope: 'archive' | 'global';
}) {
	return {
		activeObjects: 0,
		archiveUrl: options.archiveUrl ?? null,
		archiveUrlIdentity: options.archiveUrlIdentity ?? null,
		buckets: {
			activeBucketObjects: 0,
			failedBucketObjects: 0,
			pendingBucketObjects: 0,
			totalBucketObjects: 0,
			uniqueBucketHashes: 0,
			verifiedBucketObjects: 0
		},
		checkpoints: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 0,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 0,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 0,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 0,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: null,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 0,
			oldestCheckpointLedger: null,
			partialArchiveCheckpoints: 0,
			totalArchiveCheckpoints: 0
		},
		failedObjects: 0,
		generatedAt: '2026-07-06T15:35:00.000Z',
		hostThrottles: [],
		objectTypes: [],
		pendingObjects: 0,
		scope: options.scope,
		totalObjects: 0,
		verifiedObjects: 0
	};
}
