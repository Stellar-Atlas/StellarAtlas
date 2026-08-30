import { HttpError, Url, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
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

	it('acknowledges a missing broker terminal update only', async () => {
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
		httpService.post.mockResolvedValue(
			ok({
				data: { error: 'Archive object job not found' },
				headers: {},
				status: 404,
				statusText: 'Not Found'
			})
		);

		const failureResult = await service.failHistoryArchiveObject('object-1', {
			claimAttempt: 2,
			errorMessage: 'HTTP 503 Service Unavailable',
			errorType: 'archive_http_error',
			executionId: 'execution-1',
			failureChannel: 'archive_availability',
			httpStatus: 503,
			scheduler: 'broker'
		});
		const completionResult = await service.completeHistoryArchiveObject(
			'object-1',
			{}
		);
		const releaseResult = await service.releaseHistoryArchiveObject(
			'object-1',
			2
		);

		expect(failureResult.isOk()).toBe(true);
		expect(completionResult.isErr()).toBe(true);
		expect(releaseResult.isErr()).toBe(true);
	});

	it('acknowledges broker terminal-update HTTP 404 errors only', async () => {
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
		httpService.post.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 404', undefined, {
					data: { error: 'Archive object job not found' },
					headers: {},
					status: 404,
					statusText: 'Not Found'
				})
			)
		);

		const failureResult = await service.failHistoryArchiveObject('object-1', {
			errorMessage: 'not found',
			errorType: 'archive_http_error',
			failureChannel: 'archive_availability'
		});
		const completionResult = await service.completeHistoryArchiveObject(
			'object-1',
			{}
		);
		const releaseResult = await service.releaseHistoryArchiveObject(
			'object-1',
			2
		);
		const brokerCompletionResult = await service.completeHistoryArchiveObject(
			'object-1',
			{
				claimAttempt: 2,
				executionId: 'execution-1',
				scheduler: 'broker'
			}
		);

		expect(brokerCompletionResult.isOk()).toBe(true);
		expect(failureResult.isErr()).toBe(true);
		expect(completionResult.isErr()).toBe(true);
		expect(releaseResult.isErr()).toBe(true);
	});

	it('preserves unknown terminal-update 404 errors', async () => {
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
		httpService.post.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 404', undefined, {
					data: { error: 'Cannot POST this route' },
					headers: {},
					status: 404,
					statusText: 'Not Found'
				})
			)
		);

		const result = await service.completeHistoryArchiveObject('object-1', {});

		expect(result.isErr()).toBe(true);

		httpService.post.mockResolvedValue(
			ok({
				data: { error: 'Cannot POST this route' },
				headers: {},
				status: 404,
				statusText: 'Not Found'
			})
		);

		const rawResponseResult = await service.completeHistoryArchiveObject(
			'object-1',
			{}
		);

		expect(rawResponseResult.isErr()).toBe(true);
	});

	it('does not treat a missing heartbeat as committed', async () => {
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
		httpService.post.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 404', undefined, {
					data: { error: 'Archive object job not found' },
					headers: {},
					status: 404,
					statusText: 'Not Found'
				})
			)
		);

		const result = await service.touchHistoryArchiveObject('object-1');

		expect(result.isErr()).toBe(true);
	});

	it('preserves non-404 terminal update errors', async () => {
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
		httpService.post.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 500', undefined, {
					data: undefined,
					headers: {},
					status: 500,
					statusText: 'Internal Server Error'
				})
			)
		);

		const result = await service.completeHistoryArchiveObject('object-1', {});

		expect(result.isErr()).toBe(true);
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
