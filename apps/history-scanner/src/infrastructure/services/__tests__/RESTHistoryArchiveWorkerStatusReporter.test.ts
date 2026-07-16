import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { Url, type HttpService } from 'http-helper';
import { RESTHistoryArchiveWorkerStatusReporter } from '../RESTHistoryArchiveWorkerStatusReporter.js';

describe('RESTHistoryArchiveWorkerStatusReporter', () => {
	it('posts compact worker status with internal coordinator authentication', async () => {
		const httpService = mock<HttpService>();
		httpService.post.mockResolvedValue(
			ok({ data: null, headers: {}, status: 204, statusText: 'No Content' })
		);
		const reporter = new RESTHistoryArchiveWorkerStatusReporter(
			httpService,
			'http://coordinator.example',
			{ type: 'internal', username: 'worker', password: 'secret' }
		);
		const report = createReport();

		const result = await reporter.report(report);

		expect(result.isOk()).toBe(true);
		expect(httpService.post).toHaveBeenCalledWith(
			Url.create(
				'http://coordinator.example/v1/history-scan/worker-status'
			)._unsafeUnwrap(),
			report,
			{
				auth: { username: 'worker', password: 'secret' },
				connectionTimeoutMs: 5000,
				socketTimeoutMs: 5000
			}
		);
	});

	it('rejects non-success coordinator responses', async () => {
		const httpService = mock<HttpService>();
		httpService.post.mockResolvedValue(
			ok({ data: null, headers: {}, status: 500, statusText: 'Error' })
		);
		const reporter = new RESTHistoryArchiveWorkerStatusReporter(
			httpService,
			'http://coordinator.example',
			{ type: 'internal', username: 'worker', password: 'secret' }
		);

		expect((await reporter.report(createReport())).isErr()).toBe(true);
	});
});

function createReport() {
	return {
		bytesDownloaded: 1024,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket' as const
		},
		lastOutcome: 'none' as const,
		lastOutcomeAt: null,
		pid: 4123,
		processGeneration: 0,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T12:00:00.000Z',
		sequence: 1,
		stage: 'downloading_bucket' as const,
		workerId: 'object-host-4-0'
	};
}
