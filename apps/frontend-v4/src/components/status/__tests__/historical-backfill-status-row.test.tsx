import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicHistoricalFullHistoryBackfill } from '@api/types';
import { HistoricalBackfillStatusRow } from '../historical-backfill-status-row';

describe('HistoricalBackfillStatusRow', () => {
	it('renders incomplete bucket checks without claiming a remote failure', () => {
		const markup = renderToStaticMarkup(
			<HistoricalBackfillStatusRow backfill={backfill()} />
		);

		expect(markup).toContain(
			'182 checkpoints indexed; checkpoint 63,374,591 needs 9 more bucket checks on best source'
		);
		expect(markup).toContain('182 proof-gated backfill jobs completed');
		expect(markup).toContain('best source verified 28 of 37 required buckets');
		expect(markup).toContain('9 bucket checks still pending');
		expect(markup).toContain('Proof checks pending');
		expect(markup).toContain('status-pill neutral');
		expect(markup).not.toContain('remote evidence');
		expect(markup).not.toContain('files are missing');
		expect(markup).not.toContain('Waiting for proof');
		expect(markup).not.toContain('proof-pending');
	});

	it('does not present remote proof evidence as platform degradation', () => {
		const markup = renderToStaticMarkup(
			<HistoricalBackfillStatusRow backfill={backfill()} />
		);

		expect(markup).not.toContain('status-pill warning');
		expect(markup).not.toContain('Needs attention');
	});

	it('renders a precise compatibility fallback without vague proof copy', () => {
		const legacy: PublicHistoricalFullHistoryBackfill = {
			failedJobs: 0,
			latestErrorCode: 'proof-pending',
			nextCheckpointLedger: '63374591',
			pendingJobs: 1,
			runningJobs: 0,
			state: 'waiting-for-proof',
			updatedAt: '2026-07-19T12:00:00.000Z'
		};

		const markup = renderToStaticMarkup(
			<HistoricalBackfillStatusRow backfill={legacy} />
		);
		expect(markup).toContain('checkpoint 63,374,591 progress unavailable');
		expect(markup).toContain(
			'Completed progress and current source evidence are unavailable'
		);
		expect(markup).not.toContain('Waiting for proof');
		expect(markup).not.toContain('proof-pending');
	});
});

function backfill(): PublicHistoricalFullHistoryBackfill {
	return {
		completedCheckpoints: 182,
		completedJobs: 182,
		currentProof: {
			checkpointLedger: '63374591',
			expectedBucketCount: 37,
			failedBucketCount: 0,
			failureKind: 'bucket-missing',
			remainingBucketCount: 9,
			status: 'not-evaluable',
			verifiedBucketCount: 28
		},
		failedJobs: 0,
		latestErrorCode: 'proof-pending',
		nextCheckpointLedger: '63374591',
		pendingJobs: 1,
		runningJobs: 0,
		state: 'waiting-for-proof',
		updatedAt: '2026-07-19T12:00:00.000Z'
	};
}
