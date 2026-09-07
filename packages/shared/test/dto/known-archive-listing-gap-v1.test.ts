import Ajv from 'ajv';
import * as addFormats from 'ajv-formats';
import { KnownArchiveRootEvidenceV1Schema } from '../../src/dto/known-archive-evidence-v1.js';

describe('listing evidence public compatibility', () => {
	const ajv = new Ajv();
	addFormats.default(ajv);
	const validate = ajv.compile(KnownArchiveRootEvidenceV1Schema);
	const root = {
		archiveUrl: 'https://example.org/Case',
		archiveUrlIdentity: 'https://example.org/Case',
		latestObjectAt: null,
		nodePublicKeys: [],
		scannerOwnedState: null,
		checkpoints: {
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0,
			pendingCheckpoints: 0,
			totalCheckpoints: 1,
			verifiedCheckpoints: 1
		},
		objects: {
			activeObjects: 0,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 0,
			totalObjects: 1,
			verifiedBucketObjects: 0,
			verifiedObjects: 1,
			workerIssueObjects: 0
		},
		sequentialCoverage: {
			advertisedLatestCheckpointLedger: 255,
			blockedCheckpointLedger: null,
			blocker: null,
			lastContinuouslyVerifiedCheckpointLedger: 63,
			nextCheckpointLedger: 319,
			status: 'advancing'
		}
	};
	const gap = {
		kind: 'gcs-listing-gap',
		firstCheckpointLedger: 127,
		lastCheckpointLedger: 255,
		resumeCheckpointLedger: 319,
		checkpointCount: 3,
		observedAt: '2026-09-06T23:00:00Z',
		sourceCheckpointProofId: '9007199254740993',
		sourceArchiveUrlIdentity: 'https://other.example/Case',
		listings: ['history', 'ledger', 'transactions', 'results'].map(
			(category) => ({
				category,
				listingUrl: `https://listing.example/Case/${category}/`,
				responseSha256: 'a'.repeat(64),
				firstReturnedKey: `${category}-0000013f`,
				firstReturnedCheckpoint: 319
			})
		)
	};
	it('still accepts older responses without listing fields', () =>
		expect(validate(root)).toBe(true));
	it.each(['gcs-listing-gap', 's3-listing-gap', 'directory-listing-gap'])(
		'accepts %s provenance and nullable complete-prefix boundaries',
		(kind) => {
			const listings =
				kind === 'directory-listing-gap'
					? gap.listings.map((listing) => ({
							...listing,
							firstReturnedKey: null,
							firstReturnedCheckpoint: null,
							completePrefix: 'Case/history/00/00/00/',
							rangeThroughCheckpoint: 255
						}))
					: gap.listings;
			expect(
				validate({
					...root,
					listingGapCount: 1,
					listingGaps: [{ ...gap, kind, listings }]
				})
			).toBe(true);
			expect(validate.errors).toBeNull();
		}
	);
	it('rejects unsafe links, unbounded samples and incomplete category sets', () => {
		expect(
			validate({
				...root,
				listingGaps: [{ ...gap, listings: gap.listings.slice(1) }]
			})
		).toBe(false);
		expect(
			validate({ ...root, listingGaps: Array.from({ length: 21 }, () => gap) })
		).toBe(false);
		expect(
			validate({
				...root,
				listingGaps: [
					{
						...gap,
						listings: gap.listings.map((listing) => ({
							...listing,
							listingUrl: 'javascript:alert(1)'
						}))
					}
				]
			})
		).toBe(false);
	});
});
