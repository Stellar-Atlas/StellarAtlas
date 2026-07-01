import { jest } from '@jest/globals';
import type { MonitoringJob } from '../JobMonitor.js';

const init = jest.fn();
const captureCheckIn = jest.fn(() => 'id');

jest.unstable_mockModule('@sentry/node', () => ({
	init,
	captureCheckIn
}));

const { SentryJobMonitor } = await import('../SentryJobMonitor.js');

describe('SentryJobMonitor', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('should  monitor job', async () => {
		const sentryDSN = 'sentryDSN';
		const sentryJobMonitor = new SentryJobMonitor(sentryDSN);

		const startJob: MonitoringJob = {
			context: 'context',
			status: 'in_progress'
		};

		await sentryJobMonitor.checkIn(startJob);
		expect(captureCheckIn).toHaveBeenCalledTimes(1);

		const result = await sentryJobMonitor.checkIn({
			context: 'context',
			status: 'ok'
		});

		expect(result.isOk()).toBe(true);
		expect(captureCheckIn).toHaveBeenCalledTimes(2);
	});

	test('should return error if job is not started and marked as OK', async () => {
		const sentryDSN = 'sentryDSN';
		const sentryJobMonitor = new SentryJobMonitor(sentryDSN);

		const result = await sentryJobMonitor.checkIn({
			context: 'context',
			status: 'ok'
		});

		expect(result.isErr()).toBe(true);
	});

	test('should return error if Sentry returns error on captureCheckIn', async () => {
		const sentryDSN = 'sentryDSN';
		const sentryJobMonitor = new SentryJobMonitor(sentryDSN);

		captureCheckIn.mockImplementationOnce(() => {
			throw new Error('error');
		});

		const result = await sentryJobMonitor.checkIn({
			context: 'context',
			status: 'in_progress'
		});

		expect(result.isErr()).toBe(true);
	});
});
