import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { toObjectRepairAction } from '../HistoryArchiveRepairActionMapper.js';
import type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairSourceCandidateV1
} from 'shared';

describe('HistoryArchiveRepairActionMapper', () => {
	it('does not treat a remote 404 as confirmed repair evidence', () => {
		const object = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			objectKey: 'root',
			objectOrder: 1,
			objectType: 'history-archive-state',
			objectUrl:
				'https://history.example.com/.well-known/stellar-history.json',
			remoteId: crypto.randomUUID(),
			status: 'failed'
		});
		object.errorType = 'archive_http_error';
		object.errorMessage = 'Remote history archive state was not found';
		object.httpStatus = 404;
		object.nextAttemptAt = new Date('2026-07-07T18:05:00.000Z');
		(object as HistoryArchiveObject & { updatedAt: Date }).updatedAt = new Date(
			'2026-07-07T18:00:00.000Z'
		);

		const actions = toObjectRepairAction(object, [], new Map());

		expect(actions).toEqual([]);
	});

	it('creates a proof-bound, operator-safe repair manifest for a confirmed bucket mismatch', () => {
		const object = failedBucket('a');
		const source = verifiedSource(object.remoteId);
		const artifact: HistoryArchiveRepairArtifactAvailabilityV1 = {
			artifactType: 'bucket',
			byteLength: 42,
			contentHash: source.proof.contentHash,
			downloadUrl: 'https://stellaratlas.io/v1/archive-scans/repair-artifacts/buckets/' + 'b'.repeat(64),
			mediaType: 'application/gzip',
			objectIdentity: object.objectKey,
			provenAt: source.proof.evaluatedAt,
			status: 'available'
		};

		const [action] = toObjectRepairAction(
			object,
			[source],
			new Map([[object.bucketHash as string, artifact]])
		);
		expect(action.repairManifest?.evidence.errorMessage).toContain(
			'[history bucket cache path]'
		);
		expect(action.repairManifest?.evidence.errorMessage).not.toContain('/home/observe');

		expect(action.repairManifest).toEqual({
			actionId: action.actionId,
			evidence: action.evidence[0],
			generatedAt: expect.any(String),
			recheck: {
				endpoint: `/v1/archive-scans/objects/${object.remoteId}/recheck`,
				minimumEvidenceUpdatedAt: '2026-08-05T12:00:00.000Z',
				resolutionCondition: 'same-object-verified-after-original-evidence',
				targetRemoteId: object.remoteId
			},
			replacement: { artifact, source },
			schemaVersion: 1,
			status: 'ready',
			steps: [
				{ backupSuffix: '.stellaratlas-backup', kind: 'backup-current-file', order: 1, required: true },
				{ input: 'replacement-download-url', kind: 'stage-replacement', order: 2, required: true, stagingLocation: 'same-filesystem-temporary-file' },
				{ expectedContentHash: artifact.contentHash, kind: 'verify-staged-content', order: 3, required: true },
				{ kind: 'atomic-replace', order: 4, required: true, requiresSameFilesystem: true },
				{ kind: 'preserve-metadata', order: 5, preserve: ['owner', 'mode', 'acl'], required: true },
				{ kind: 'request-recheck', order: 6, required: true, resolutionCondition: 'same-object-verified-after-original-evidence' }
			],
			target: {
				archiveUrl: object.archiveUrl,
				archiveUrlIdentity: object.archiveUrlIdentity,
				bucketHash: object.bucketHash,
				checkpointLedger: object.checkpointLedger,
				objectKey: object.objectKey,
				objectType: object.objectType,
				objectUrl: object.objectUrl,
				operatorTargetPathRequired: true
			}
		});
	});

	it('does not issue replacement instructions when the source proof and artifact digest disagree', () => {
		const object = failedBucket('c');
		const source = verifiedSource(object.remoteId);
		const artifact: HistoryArchiveRepairArtifactAvailabilityV1 = {
			artifactType: 'bucket',
			byteLength: 42,
			contentHash: {
				algorithm: 'sha256',
				digest: 'd'.repeat(64),
				representation: 'uncompressed-xdr'
			},
			downloadUrl: 'https://stellaratlas.io/invalid',
			mediaType: 'application/gzip',
			objectIdentity: object.objectKey,
			provenAt: source.proof.evaluatedAt,
			status: 'available'
		};

		const [action] = toObjectRepairAction(
			object,
			[source],
			new Map([[object.bucketHash as string, artifact]])
		);

		expect(action.repairManifest).toMatchObject({
			replacement: null,
			status: 'awaiting-verified-replacement',
			steps: []
		});
	});
});

function failedBucket(seed: string): HistoryArchiveObject {
	const bucketHash = seed.repeat(64);
	const object = new HistoryArchiveObject({
		archiveUrl: 'https://history.example.com',
		archiveUrlIdentity: 'https://history.example.com',
		bucketHash,
		checkpointLedger: 63,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 1,
		objectType: 'bucket',
		objectUrl: `https://history.example.com/bucket/${bucketHash}.xdr.gz`,
		remoteId: crypto.randomUUID(),
		status: 'failed'
	});
	object.errorType = 'HASH_MISMATCH';
	object.errorMessage =
		'Hash mismatch while reading /home/observe/stellarbeat-data/Observer/history-bucket-cache/aa/bb.xdr.gz';
	(object as HistoryArchiveObject & { updatedAt: Date }).updatedAt = new Date(
		'2026-08-05T12:00:00.000Z'
	);
	return object;
}

function verifiedSource(
	targetRemoteId: string
): HistoryArchiveRepairSourceCandidateV1 {
	return {
		archiveUrl: 'https://verified.example.com',
		archiveUrlIdentity: 'https://verified.example.com',
		objectUrl: 'https://verified.example.com/bucket/' + 'b'.repeat(64) + '.xdr.gz',
		proof: {
			anchor: { kind: 'content-addressed-bucket', sourceCount: 2 },
			candidateObjectRemoteId: crypto.randomUUID(),
			checkpointLedger: 63,
			contentHash: {
				algorithm: 'sha256',
				digest: 'b'.repeat(64),
				representation: 'uncompressed-xdr'
			},
			evaluatedAt: '2026-08-05T12:01:00.000Z',
			kind: 'strict-checkpoint',
			proofId: '7',
			proofVersion: 1
		},
		verifiedAt: '2026-08-05T12:01:00.000Z'
	};
}
