import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scpStatementObservationPolicy } from '@network-scan/domain/scp/ScpStatementObservationPolicy.js';
import {
	getScpLiveProcessShutdownTimeoutMs,
	parseScpLiveShutdownDrainTimeoutMs,
	scpLiveMaxDrainTimeoutMs
} from '../ScpLiveShutdownPolicy.js';

describe('live SCP service shutdown policy', () => {
	it('gives the collector drain less time than systemd gives the process', async () => {
		const service = await readFile(
			resolve(
				process.cwd(),
				'ops/systemd/stellaratlas-scp-live-scanner.service'
			),
			'utf8'
		);
		const drainTimeoutMs = Number(
			service.match(/SCP_LIVE_SHUTDOWN_DRAIN_TIMEOUT_MS=(\d+)/)?.[1]
		);
		const systemdTimeoutMs =
			Number(service.match(/TimeoutStopSec=(\d+)/)?.[1]) * 1_000;

		expect(drainTimeoutMs).toBe(
			scpStatementObservationPolicy.shutdownDrainTimeoutMs
		);
		expect(systemdTimeoutMs).toBe(
			scpStatementObservationPolicy.systemdStopTimeoutMs
		);
		expect(systemdTimeoutMs).toBeGreaterThan(drainTimeoutMs);
	});

	it('clamps an EnvironmentFile override and preserves incomplete-drain headroom', () => {
		const drainTimeoutMs = parseScpLiveShutdownDrainTimeoutMs('999999999');
		const processTimeoutMs = getScpLiveProcessShutdownTimeoutMs(drainTimeoutMs);

		expect(drainTimeoutMs).toBe(scpLiveMaxDrainTimeoutMs);
		expect(processTimeoutMs - drainTimeoutMs).toBeGreaterThanOrEqual(
			scpStatementObservationPolicy.shutdownKernelBudgetMs
		);
		expect(
			scpStatementObservationPolicy.systemdStopTimeoutMs - processTimeoutMs
		).toBeGreaterThanOrEqual(
			scpStatementObservationPolicy.shutdownSystemdHeadroomMs
		);
	});
});
