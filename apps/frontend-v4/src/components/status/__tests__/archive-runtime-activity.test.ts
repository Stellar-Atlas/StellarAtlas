/// <reference types="jest" />

import { resolveArchiveRuntimeActivity } from '../archive-runtime-activity';

describe('resolveArchiveRuntimeActivity', () => {
	it('prefers current worker telemetry over a stale server-rendered sample', () => {
		expect(
			resolveArchiveRuntimeActivity(
				{ freshActiveObjects: 22, staleActiveObjects: 2 },
				{
					activeWorkers: 24,
					lastHeartbeatAt: '2026-07-16T11:47:30.000Z',
					registeredWorkers: 24,
					staleWorkers: 0
				}
			)
		).toEqual({ activeChecks: 24, staleChecks: 0 });
	});

	it('uses the queue sample before worker telemetry is available', () => {
		expect(
			resolveArchiveRuntimeActivity(
				{ freshActiveObjects: 3, staleActiveObjects: 1 },
				{
					activeWorkers: 0,
					lastHeartbeatAt: null,
					registeredWorkers: 0,
					staleWorkers: 0
				}
			)
		).toEqual({ activeChecks: 3, staleChecks: 1 });
	});
});
