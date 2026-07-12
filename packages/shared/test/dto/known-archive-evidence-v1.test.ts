import Ajv from 'ajv';
import * as addFormats from 'ajv-formats';
import {
	KnownNodeArchiveEvidenceV1Schema,
	KnownOrganizationArchiveEvidenceV1Schema
} from '../../src/dto/known-archive-evidence-v1';

describe('known archive evidence DTOs', () => {
	it('validates paginated node and organization evidence', () => {
		const ajv = new Ajv();
		addFormats.default(ajv);
		const validateNode = ajv.compile(KnownNodeArchiveEvidenceV1Schema);
		const validateOrganization = ajv.compile(
			KnownOrganizationArchiveEvidenceV1Schema
		);
		const evidence = createEvidence();

		const nodeIsValid = validateNode({
			...evidence,
			organizationId: 'org-id',
			publicKey: 'GNODE'
		});
		expect(validateNode.errors).toBeNull();
		expect(nodeIsValid).toBe(true);
		expect(
			validateOrganization({ ...evidence, organizationId: 'org-id' })
		).toBe(true);
	});

	it('requires cursor page metadata', () => {
		const ajv = new Ajv();
		addFormats.default(ajv);
		const validate = ajv.compile(KnownNodeArchiveEvidenceV1Schema);
		const evidence = createEvidence();
		const invalid = {
			...evidence,
			objectPage: { ...evidence.objectPage, page: { limit: 25 } },
			organizationId: null,
			publicKey: 'GNODE'
		};

		expect(validate(invalid)).toBe(false);
	});

	it('requires an HTTP(S) object URL for each verified copy', () => {
		const ajv = new Ajv();
		addFormats.default(ajv);
		const validate = ajv.compile(KnownNodeArchiveEvidenceV1Schema);
		const evidence = createEvidence();
		const copy = {
			archiveUrl: 'https://copy.example/archive',
			archiveUrlIdentity: 'https://copy.example/archive',
			objectUrl: 'https://copy.example/Case/Object.xdr.gz?token=AbC',
			remoteId: 'copy-id',
			verifiedAt: '2026-07-10T00:00:00.000Z'
		};
		const input = {
			...evidence,
			organizationId: null,
			publicKey: 'GNODE',
			remoteFailures: {
				...evidence.remoteFailures,
				failures: [createFailure(copy)]
			}
		};

		expect(validate(input)).toBe(true);
		expect(
			validate({
				...input,
				remoteFailures: {
					...input.remoteFailures,
					failures: [createFailure({ ...copy, objectUrl: 'file:///tmp/a' })]
				}
			})
		).toBe(false);
	});
});

function createFailure(copy: object) {
	return {
		networkVerifiedCopies: { copies: [copy], count: 1, sampleLimit: 10 },
		object: createHistoryArchiveObject(),
		sameOrganizationVerifiedCopies: { copies: [], count: 0, sampleLimit: 10 }
	};
}

function createHistoryArchiveObject() {
	return {
		archiveUrl: 'https://source.example/archive',
		archiveUrlIdentity: 'https://source.example/archive',
		attempts: 1,
		bucketHash: null,
		bytesDownloaded: null,
		claimedAt: null,
		checkpointLedger: 63,
		delayReason: null,
		error: null,
		nextAttemptAt: null,
		objectKey: 'ledger:0000003f',
		objectType: 'ledger',
		objectUrl: 'https://source.example/archive/ledger/object.xdr.gz',
		refreshAfter: null,
		remoteId: 'source-id',
		status: 'failed',
		updatedAt: '2026-07-10T00:00:00.000Z',
		verificationFacts: null,
		verifiedAt: null,
		workerStage: null
	};
}

function createEvidence() {
	return {
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: null,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page: {
				hasMore: false,
				limit: 25,
				nextCursor: null,
				snapshotAt: '2026-07-10T00:00:00.000Z',
				total: 0
			}
		},
		generatedAt: '2026-07-10T00:00:00.000Z',
		nodePublicKeys: [],
		objectPage: {
			filters: {
				archiveUrlIdentity: null,
				objectType: null,
				status: null
			},
			objects: [],
			page: {
				hasMore: false,
				limit: 25,
				nextCursor: null,
				snapshotAt: '2026-07-10T00:00:00.000Z',
				total: 0
			}
		},
		remoteFailures: {
			failures: [],
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			limit: 25,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		},
		roots: [],
		totals: {
			archiveRoots: 0,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			nodes: 0,
			objects: {
				activeObjects: 0,
				bucketObjects: 0,
				pendingObjects: 0,
				remoteFailureObjects: 0,
				totalObjects: 0,
				verifiedBucketObjects: 0,
				verifiedObjects: 0,
				workerIssueObjects: 0
			}
		},
		workerIssues: {
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			issues: [],
			limit: 25,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		}
	};
}
