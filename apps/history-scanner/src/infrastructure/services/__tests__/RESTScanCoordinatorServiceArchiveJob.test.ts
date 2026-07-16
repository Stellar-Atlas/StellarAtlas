import { Url, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { RESTScanCoordinatorService } from '../RESTScanCoordinatorService.js';

describe('RESTScanCoordinatorService archive object claims', () => {
	it('uses the bounded coordinator read budget for a mutating claim request', async () => {
		const httpService = mock<HttpService>();
		const service = new RESTScanCoordinatorService(
			httpService,
			'http://coordinator.example',
			{
				password: 'secret',
				type: 'internal',
				username: 'scanner'
			}
		);
		httpService.get.mockResolvedValue(
			ok({
				data: archiveObjectJob(),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);

		const result = await service.getHistoryArchiveObjectJob();

		expect(result.isOk()).toBe(true);
		expect(httpService.get).toHaveBeenCalledWith(
			Url.create(
				'http://coordinator.example/v1/history-scan/archive-object-job'
			)._unsafeUnwrap(),
			{
				auth: { password: 'secret', username: 'scanner' },
				connectionTimeoutMs: 30_000,
				responseType: 'json',
				socketTimeoutMs: 30_000
			}
		);
	});
});

function archiveObjectJob() {
	return {
		archiveUrl: 'https://history.example',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 2,
		objectKey: 'checkpoint-state:0000003f',
		objectType: 'checkpoint-state',
		objectUrl: 'https://history.example/history/00/00/00/history-0000003f.json',
		remoteId: '82a309de-a5df-457b-9412-f267ed5e7388'
	} as const;
}
