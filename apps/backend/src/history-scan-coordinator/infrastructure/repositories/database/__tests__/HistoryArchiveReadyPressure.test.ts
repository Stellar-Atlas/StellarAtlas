import { buildHistoryArchiveReadyPressureSql } from '../HistoryArchiveObjectReadyQueue.js';
import { calculateHistoryArchivePlanningPressure } from '../../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';

describe('bounded archive execution pressure', () => {
	it('forces a unique indexed object lookup for each compact ready key', () => {
		const sql = buildHistoryArchiveReadyPressureSql(2);
		expect(sql).toMatch(
			/join lateral \([\s\S]*?candidate\."remoteId" = queued\."objectRemoteId"\s+limit 1\s+\) object on true/
		);
		expect(sql).not.toContain('join "history_archive_object_queue" object');
		expect(sql).not.toContain('"verifiedAt" >=');
		expect(sql).not.toContain('recent_events');
		expect(sql).toContain('ready_probe_candidates as materialized');
		expect(sql).toContain('limit 129::integer');
		expect(sql).toContain('as "pressureUnavailable"');
		expect(sql).toContain('null::integer as "recentCompletions"');
	});

	it('preserves active, published, token, eligibility, host and priority gates', () => {
		const sql = buildHistoryArchiveReadyPressureSql(1, '$1::text');
		for (const gate of [
			'slot."objectRemoteId" is not null',
			'queued."publishedAt" is not null',
			'queued."dispatchToken" is not null',
			'queued."availableAt" <= now()',
			'object."dependencyReady" = true',
			'object."transitionEffectsCompletedAt" is not null',
			'object."archiveUrlIdentity" = $1::text',
			'throttle."blockedUntil" > now()',
			'1::smallint'
		])
			expect(sql).toContain(gate);
	});

	it('does not turn an unsampled diagnostic into zero or change admission', () => {
		const sampled = calculateHistoryArchivePlanningPressure({
			outstandingObjects: 7,
			recentCompletions: 100_000
		});
		const unsampled = calculateHistoryArchivePlanningPressure({
			outstandingObjects: 7,
			recentCompletions: null
		});
		expect(unsampled).toEqual({ ...sampled, recentCompletions: null });
	});
});
