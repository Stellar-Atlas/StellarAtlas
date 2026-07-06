import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { HttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectJobDTO } from '../../../domain/scan/ScanCoordinatorService.js';
import type { ScanCoordinatorService } from '../../../domain/scan/ScanCoordinatorService.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import { ArchiveObjectCategoryVerifier } from '../ArchiveObjectCategoryVerifier.js';

describe('ArchiveObjectCategoryVerifier', () => {
	it('preserves HTTP status on category fetch failures', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 403', undefined, {
					data: {},
					headers: {},
					status: 403,
					statusText: 'Forbidden'
				})
			)
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			mock<HistoryArchiveStateValidator>(),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCategoryObject(createObjectJob());

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toMatchObject({
				errorType: 'archive_http_error',
				httpStatus: 403
			});
		}
	});

	it('returns checkpoint history archive state facts for checkpoint objects', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			ok({
				data: createHistoryArchiveState(),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			new HistoryArchiveStateValidator(mock<Logger>()),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCheckpointState(
			createObjectJob({
				objectKey: 'checkpoint-state:0000007f',
				objectType: 'checkpoint-state',
				objectUrl:
					'https://archive.example/history/00/00/00/history-0000007f.json'
			})
		);

		expect(result._unsafeUnwrap()).toMatchObject({
			bytesDownloaded: expect.any(Number),
			verificationFacts: {
				checkpointHistoryArchiveState: {
					stellarHistory: { currentLedger: 127 },
					stellarHistoryUrl:
						'https://archive.example/history/00/00/00/history-0000007f.json'
				}
			},
			workerStage: 'verified'
		});
	});
});

function createObjectJob(
	overrides: Partial<HistoryArchiveObjectJobDTO> = {}
): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://archive.example',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 1,
		objectKey: 'ledger:0000003f',
		objectType: 'ledger',
		objectUrl: 'https://archive.example/ledger/00/00/00/ledger-0000003f.xdr.gz',
		remoteId: 'object-1',
		...overrides
	};
}

function createHistoryArchiveState(): Record<string, unknown> {
	return {
		currentBuckets: [
			{
				curr: '4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				next: { state: 0 },
				snap: '0000000000000000000000000000000000000000000000000000000000000000'
			}
		],
		currentLedger: 127,
		server: 'stellar-core',
		version: 1
	};
}
