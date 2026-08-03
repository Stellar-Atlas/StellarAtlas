/// <reference types="jest" />

import { resolveArchiveRuntimeActivity } from '../archive-runtime-activity';

describe('resolveArchiveRuntimeActivity', () => {
	it('prefers current worker telemetry over a stale server-rendered sample', () => {
		expect(
			resolveArchiveRuntimeActivity(
				{ freshActiveObjects: 22, staleActiveObjects: 2 },
				{
					lastHeartbeatAt: '2026-07-16T11:47:30.000Z',
					queueActiveWorkers: 2,
					registeredWorkers: 24,
					queueStaleWorkers: 0
				}
			)
		).toEqual({ activeChecks: 2, staleChecks: 0 });
	});

	it('uses the queue sample before worker telemetry is available', () => {
		expect(
			resolveArchiveRuntimeActivity(
				{ freshActiveObjects: 3, staleActiveObjects: 1 },
				{
					lastHeartbeatAt: null,
					queueActiveWorkers: 0,
					registeredWorkers: 0,
					queueStaleWorkers: 0
				}
			)
		).toEqual({ activeChecks: 3, staleChecks: 1 });
	});
});
