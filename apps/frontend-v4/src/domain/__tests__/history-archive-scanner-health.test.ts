import {
	assessArchiveScannerHealth,
	type AssessArchiveScannerHealthInput
} from '../history-archive-health';

const ready: AssessArchiveScannerHealthInput = {
	activeChecks: 0,
	configuredWorkers: 120,
	freshWorkers: 120,
	missingWorkers: 0,
	proofComplete: false,
	staleChecks: 0,
	telemetryAvailable: true,
	waitingChecks: 0,
	workerStatus: 'ok'
};

describe('healthy idle archive scanner', () => {
	it.each([false, true])(
		'reports idle independently of proof completion: %p',
		(proofComplete) => {
			expect(assessArchiveScannerHealth({ ...ready, proofComplete })).toBe(
				'idle'
			);
		}
	);

	it.each([
		{ missingWorkers: 1 },
		{ staleChecks: 1 },
		{ workerStatus: 'degraded' as const },
		{ workerStatus: 'unavailable' as const }
	])('preserves a real runtime fault: %p', (overrides) => {
		expect(assessArchiveScannerHealth({ ...ready, ...overrides })).toBe(
			'scanner_issue'
		);
	});

	it.each([
		{ telemetryAvailable: false },
		{ freshWorkers: 0 },
		{ freshWorkers: 119 },
		{ configuredWorkers: 0, freshWorkers: 0 }
	])(
		'does not infer readiness without all configured workers fresh: %p',
		(overrides) => {
			expect(assessArchiveScannerHealth({ ...ready, ...overrides })).toBe(
				'unknown'
			);
		}
	);

	it('keeps active and queued work distinct from idle', () => {
		expect(assessArchiveScannerHealth({ ...ready, activeChecks: 2 })).toBe(
			'checking'
		);
		expect(assessArchiveScannerHealth({ ...ready, waitingChecks: 2 })).toBe(
			'waiting'
		);
	});
});
