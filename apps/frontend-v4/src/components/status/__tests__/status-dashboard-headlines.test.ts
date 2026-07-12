/// <reference types="jest" />

import type { ArchiveHealthAssessment } from '@domain/history-archive-health';
import {
	buildStatusHeadlineCards,
	combineStatusLevels,
	describeArchiveRuntimeHeadline,
	describeArchiveSourceFinding
} from '../status-dashboard-headlines';

describe('status dashboard headlines', () => {
	it('leads with public API status and keeps remote findings separate', () => {
		const archiveFinding = describeArchiveSourceFinding(
			createAssessment('remote_failure', {
				expectedCheckpointProofs: 75_000_000,
				failingArchiveSources: 2
			}),
			12
		);
		const cards = buildStatusHeadlineCards({
			archiveFinding,
			archiveRuntime: {
				detail: '24 configured workers; no stale checks',
				state: 'verified',
				value: 'Scanner idle'
			},
			network: { detail: '480 recent scans completed', status: 'ok' },
			platform: { detail: 'Frontend and public API', status: 'ok' }
		});

		expect(cards.map((card) => card.label)).toEqual([
			'Public API',
			'Network monitoring',
			'Archive verification runtime',
			'Archive source findings'
		]);
		expect(cards[0]).toMatchObject({ tone: 'good', value: 'Operational' });
		expect(cards[3]).toMatchObject({
			tone: undefined,
			value: '2 archive sources with findings'
		});
		expect(cards[3]?.detail).toContain(
			'does not indicate StellarAtlas service degradation'
		);
		expect(JSON.stringify(cards)).not.toContain('75,000,000');
		expect(JSON.stringify(cards)).not.toContain('75000000');
	});

	it('uses the worse of network completion and data freshness', () => {
		expect(combineStatusLevels('ok', 'degraded')).toBe('degraded');
		expect(combineStatusLevels('degraded', 'unavailable')).toBe('unavailable');
		expect(combineStatusLevels('ok', 'ok')).toBe('ok');
	});

	it('reports evidence collection issues without changing platform health', () => {
		const archiveFinding = describeArchiveSourceFinding(
			createAssessment('scanner_issue', { scannerIssues: 1 }),
			4
		);
		const cards = buildStatusHeadlineCards({
			archiveFinding,
			archiveRuntime: {
				detail: 'Worker telemetry requires review',
				state: 'scanner_issue',
				value: 'Scanner issue'
			},
			network: { detail: 'Network data is current', status: 'ok' },
			platform: { detail: 'Frontend and public API', status: 'ok' }
		});

		expect(cards[0]).toMatchObject({ tone: 'good', value: 'Operational' });
		expect(cards[3]).toMatchObject({
			tone: 'warning',
			value: 'Evidence collection issue'
		});
	});

	it('uses a qualitative queued headline instead of the proof denominator', () => {
		const headline = describeArchiveRuntimeHeadline({
			activeChecks: 0,
			staleChecks: 0,
			state: 'waiting'
		});

		expect(headline).toBe('Checks queued');
		expect(headline).not.toContain('75,000,000');
	});
});

function createAssessment(
	state: ArchiveHealthAssessment['state'],
	overrides: Partial<ArchiveHealthAssessment['facts']> = {}
): ArchiveHealthAssessment {
	return {
		facts: {
			activeChecks: 0,
			checkpointMismatches: 0,
			expectedCheckpointProofs: 0,
			failedEvidenceRows: 0,
			failingArchiveSources: 0,
			provenCheckpointProofs: 0,
			remoteHostFailures: 0,
			scannerIssues: 0,
			unclassifiedFailures: 0,
			waitingChecks: 0,
			...overrides
		},
		state
	};
}
