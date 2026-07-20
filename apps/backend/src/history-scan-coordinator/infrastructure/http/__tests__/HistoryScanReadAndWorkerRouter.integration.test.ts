import express from 'express';
import request from 'supertest';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import {
	HistoryScanRouterWrapper,
	type HistoryScanRouterConfig
} from '../HistoryScanRouter.js';
import { InvalidUrlError } from '../../../use-cases/get-latest-scan/InvalidUrlError.js';

describe('HistoryScanRouter read and worker endpoints', () => {
	let app: express.Application;
	let config: DeepMockProxy<HistoryScanRouterConfig>;

	beforeEach(() => {
		config = mockDeep<HistoryScanRouterConfig>();
		Object.assign(config, { password: 'secret', userName: 'admin' });
		app = express();
		app.use(express.json());
		app.use('/history-scan', HistoryScanRouterWrapper(config));
	});

	it('requires scanner authentication for worker status', async () => {
		await request(app)
			.post('/history-scan/worker-status')
			.send(createWorkerReport())
			.expect(401);
	});

	it('accepts a compact typed worker report', async () => {
		config.reportHistoryArchiveWorkerStatus.execute.mockResolvedValue(
			ok(undefined)
		);
		const report = createWorkerReport();

		await request(app)
			.post('/history-scan/worker-status')
			.auth('admin', 'secret')
			.send(report)
			.expect(204);
		expect(
			config.reportHistoryArchiveWorkerStatus.execute
		).toHaveBeenCalledWith(report);
	});

	it('rejects free-form worker log fields', async () => {
		await request(app)
			.post('/history-scan/worker-status')
			.auth('admin', 'secret')
			.send({ ...createWorkerReport(), log: 'remote response body' })
			.expect(400);
		expect(
			config.reportHistoryArchiveWorkerStatus.execute
		).not.toHaveBeenCalled();
	});

	it('returns 400 for an invalid archive URL', async () => {
		await request(app)
			.get('/history-scan/invalid-url')
			.expect(400)
			.expect('Content-Type', /json/)
			.expect((response) => {
				expect(response.body.errors).toBeDefined();
			});
	});

	it('returns 400 when the read use case rejects the URL', async () => {
		config.getLatestScan.execute.mockResolvedValue(
			err(new InvalidUrlError('test.com'))
		);
		await request(app)
			.get('/history-scan/https%3A%2F%2Ftest.com')
			.expect(400)
			.expect((response) => {
				expect(response.body.error).toBe('Invalid url');
			});
	});

	it('uses the frontend cache age for archive scan reads', async () => {
		config.getLatestScan.execute.mockResolvedValue(ok(null));
		await request(app)
			.get('/history-scan/https%3A%2F%2Ftest.com')
			.expect(204)
			.expect('Cache-Control', 'public, max-age=10');
	});

	it('uses the frontend cache age for archive scan logs', async () => {
		config.getScanLogs.execute.mockResolvedValue(ok([]));
		await request(app)
			.get('/history-scan/logs/https%3A%2F%2Ftest.com')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual([]);
			});
	});
});

function createWorkerReport() {
	return {
		bytesDownloaded: 1024,
		bytesTotal: 4096,
		claimAttempt: 3,
		currentObject: {
			remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
			source: 'https://archive.example',
			type: 'bucket'
		},
		lastOutcome: 'none',
		lastOutcomeAt: null,
		pid: 4123,
		processGeneration: 0,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T12:00:00.000Z',
		sequence: 1,
		slotIndex: 0,
		stage: 'downloading_bucket',
		workerId: 'object-host-0-0'
	};
}
