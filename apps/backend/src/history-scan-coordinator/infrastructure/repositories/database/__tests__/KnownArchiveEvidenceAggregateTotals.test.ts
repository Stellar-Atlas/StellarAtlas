import type { KnownArchiveObjectCountsV1 } from 'shared';
import {
	applyKnownArchiveFailureAggregateTotal,
	applyKnownArchiveObjectAggregateTotal
} from '../KnownArchiveEvidenceAggregateTotals.js';

const snapshotAt = new Date('2026-07-12T00:00:00.000Z');
const rootA = createRoot('archive-a', {
	activeObjects: 2,
	bucketObjects: 20,
	pendingObjects: 3,
	remoteFailureObjects: 4,
	totalObjects: 100,
	verifiedBucketObjects: 18,
	verifiedObjects: 89,
	workerIssueObjects: 2
});
const rootB = createRoot('archive-b', {
	activeObjects: 1,
	bucketObjects: 40,
	pendingObjects: 5,
	remoteFailureObjects: 7,
	totalObjects: 200,
	verifiedBucketObjects: 30,
	verifiedObjects: 184,
	workerIssueObjects: 3
});

describe('known archive aggregate page totals', () => {
	it('derives exact default, status, bucket, and archive totals', () => {
		expect(
			applyKnownArchiveObjectAggregateTotal(objectPage(), [rootA, rootB])
				.snapshotTotal
		).toBe(300);
		expect(
			applyKnownArchiveObjectAggregateTotal(objectPage({ status: 'pending' }), [
				rootA,
				rootB
			]).snapshotTotal
		).toBe(8);
		expect(
			applyKnownArchiveObjectAggregateTotal(
				objectPage({ objectType: 'bucket', status: 'verified' }),
				[rootA, rootB]
			).snapshotTotal
		).toBe(48);
		expect(
			applyKnownArchiveObjectAggregateTotal(
				objectPage({ archiveUrlIdentity: 'archive-b' }),
				[rootA, rootB]
			).snapshotTotal
		).toBe(200);
	});

	it('uses failed totals only when every failed row is classified', () => {
		expect(
			applyKnownArchiveObjectAggregateTotal(objectPage({ status: 'failed' }), [
				rootA,
				rootB
			]).snapshotTotal
		).toBe(16);
		const unclassified = createRoot('archive-b', {
			...rootB.objects,
			verifiedObjects: 183
		});
		expect(
			applyKnownArchiveObjectAggregateTotal(objectPage({ status: 'failed' }), [
				rootA,
				unclassified
			]).snapshotTotal
		).toBeNull();
	});

	it('derives untyped failure totals and preserves filtered fallbacks', () => {
		expect(
			applyKnownArchiveFailureAggregateTotal(
				failurePage(),
				[rootA, rootB],
				'remote'
			).snapshotTotal
		).toBe(11);
		expect(
			applyKnownArchiveFailureAggregateTotal(
				failurePage({ objectType: 'ledger' }),
				[rootA, rootB],
				'infrastructure'
			).snapshotTotal
		).toBeNull();
	});

	it('does not replace a cursor-provided total', () => {
		expect(
			applyKnownArchiveObjectAggregateTotal(
				{ ...objectPage(), snapshotTotal: 17 },
				[rootA, rootB]
			).snapshotTotal
		).toBe(17);
	});
});

function createRoot(
	archiveUrlIdentity: string,
	objects: KnownArchiveObjectCountsV1
) {
	return { archiveUrlIdentity, objects };
}

function objectPage(
	filters: Partial<{
		archiveUrlIdentity: string | null;
		objectType: 'bucket' | 'ledger' | null;
		status: 'failed' | 'pending' | 'verified' | null;
	}> = {}
) {
	return {
		before: null,
		filters: {
			archiveUrlIdentity: filters.archiveUrlIdentity ?? null,
			objectType: filters.objectType ?? null,
			status: filters.status ?? null
		},
		limit: 25,
		snapshotAt,
		snapshotTotal: null
	};
}

function failurePage(
	filters: Partial<{
		archiveUrlIdentity: string | null;
		objectType: 'ledger' | null;
	}> = {}
) {
	return {
		before: null,
		filters: {
			archiveUrlIdentity: filters.archiveUrlIdentity ?? null,
			objectType: filters.objectType ?? null
		},
		limit: 25,
		snapshotAt,
		snapshotTotal: null
	};
}
