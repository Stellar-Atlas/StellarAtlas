import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { err } from 'neverthrow';
import { HttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
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
});

function createObjectJob(): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://archive.example',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 1,
		objectKey: 'ledger:0000003f',
		objectType: 'ledger',
		objectUrl: 'https://archive.example/ledger/00/00/00/ledger-0000003f.xdr.gz',
		remoteId: 'object-1'
	};
}
