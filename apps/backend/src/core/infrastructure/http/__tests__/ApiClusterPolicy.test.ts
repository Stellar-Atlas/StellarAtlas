import {
	defaultApiWorkerCount,
	maxApiWorkerCount,
	parseApiWorkerCount,
	shouldRestartApiWorker
} from '../ApiClusterPolicy.js';

describe('parseApiWorkerCount', () => {
	it('defaults to four workers when API_WORKERS is absent or blank', () => {
		expect(parseApiWorkerCount(undefined)).toBe(defaultApiWorkerCount);
		expect(parseApiWorkerCount('   ')).toBe(defaultApiWorkerCount);
	});

	it('accepts a bounded base-10 integer override', () => {
		expect(parseApiWorkerCount(' 8 ')).toBe(8);
		expect(parseApiWorkerCount(String(maxApiWorkerCount))).toBe(
			maxApiWorkerCount
		);
	});

	it.each(['0', '-1', '1.5', '1e1', '0x10', 'workers', '17'])(
		'rejects invalid or unbounded API_WORKERS value %s',
		(rawValue) => {
			expect(() => parseApiWorkerCount(rawValue)).toThrow(
				`API_WORKERS must be a base-10 integer between 1 and ${maxApiWorkerCount}`
			);
		}
	);
});

describe('shouldRestartApiWorker', () => {
	it('replaces a worker that exits unexpectedly', () => {
		expect(
			shouldRestartApiWorker({
				exitedAfterDisconnect: false,
				shutdownStarted: false
			})
		).toBe(true);
	});

	it('does not replace workers during cluster shutdown', () => {
		expect(
			shouldRestartApiWorker({
				exitedAfterDisconnect: false,
				shutdownStarted: true
			})
		).toBe(false);
	});

	it('does not replace a worker after an intentional disconnect', () => {
		expect(
			shouldRestartApiWorker({
				exitedAfterDisconnect: true,
				shutdownStarted: false
			})
		).toBe(false);
	});
});
