import { Readable } from 'node:stream';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveRepairObjectArtifactRepository } from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import { GetHistoryArchiveRepairObjectArtifact } from '../GetHistoryArchiveRepairObjectArtifact.js';

const targetRemoteId = '11111111-1111-4111-8111-111111111111';
const candidateRemoteId = '22222222-2222-4222-8222-222222222222';
const digest = '7'.repeat(64);

describe('GetHistoryArchiveRepairObjectArtifact', () => {
	it('opens the exact source only while its strict proof identity remains current', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const artifactRepository =
			mock<HistoryArchiveRepairObjectArtifactRepository>();
		const useCase = new GetHistoryArchiveRepairObjectArtifact(
			objectRepository,
			artifactRepository
		);
		objectRepository.findByRemoteId.mockResolvedValue(createTarget());
		objectRepository.findVerifiedCheckpointObjectSources.mockResolvedValue([
			createSource()
		]);
		artifactRepository.openVerifiedObject.mockResolvedValue({
			byteLength: 42,
			close: async () => undefined,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			fileName: 'transactions-0000003f.xdr.gz',
			mediaType: 'application/gzip',
			objectIdentity: 'transactions:0000003f',
			provenAt: new Date('2026-07-19T00:02:00.000Z'),
			status: 'available',
			stream: Readable.from([Buffer.from('verified')])
		});

		const result = await useCase.execute(createRequest());

		expect(result).toMatchObject({
			contentDigest: digest,
			status: 'available'
		});
		expect(
			objectRepository.findVerifiedCheckpointObjectSources
		).toHaveBeenCalledWith([targetRemoteId], 5);
		expect(artifactRepository.openVerifiedObject).toHaveBeenCalledWith({
			archiveUrl: 'https://source.example/history',
			archiveUrlIdentity: 'https://source.example/history',
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			objectIdentity: 'transactions:0000003f',
			objectUrl:
				'https://source.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz'
		});
	});

	it.each([
		[
			'candidate id',
			{ candidateRemoteId: '33333333-3333-4333-8333-333333333333' }
		],
		['proof id', { proofId: '42' }],
		['proof version', { proofVersion: 8 }],
		['content digest', { contentDigest: '8'.repeat(64) }]
	])('fails closed when the %s no longer matches', async (_label, change) => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const artifactRepository =
			mock<HistoryArchiveRepairObjectArtifactRepository>();
		const useCase = new GetHistoryArchiveRepairObjectArtifact(
			objectRepository,
			artifactRepository
		);
		objectRepository.findByRemoteId.mockResolvedValue(createTarget());
		objectRepository.findVerifiedCheckpointObjectSources.mockResolvedValue([
			createSource()
		]);

		await expect(
			useCase.execute({ ...createRequest(), ...change })
		).resolves.toEqual({
			reason: 'proof-no-longer-valid',
			retryAfterSeconds: null,
			retryable: false,
			status: 'unavailable'
		});
		expect(artifactRepository.openVerifiedObject).not.toHaveBeenCalled();
	});

	it('does not fetch for a target that is no longer a repairable failure', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const artifactRepository =
			mock<HistoryArchiveRepairObjectArtifactRepository>();
		const useCase = new GetHistoryArchiveRepairObjectArtifact(
			objectRepository,
			artifactRepository
		);
		const target = createTarget();
		target.status = 'verified';
		objectRepository.findByRemoteId.mockResolvedValue(target);

		await expect(useCase.execute(createRequest())).resolves.toMatchObject({
			reason: 'proof-no-longer-valid',
			status: 'unavailable'
		});
		expect(
			objectRepository.findVerifiedCheckpointObjectSources
		).not.toHaveBeenCalled();
		expect(artifactRepository.openVerifiedObject).not.toHaveBeenCalled();
	});

	it('downloads a source-backed bucket when the local cache misses', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		const artifactRepository =
			mock<HistoryArchiveRepairObjectArtifactRepository>();
		const useCase = new GetHistoryArchiveRepairObjectArtifact(
			objectRepository,
			artifactRepository
		);
		const target = createTarget();
		target.objectType = 'bucket';
		target.objectKey = `bucket:${digest}`;
		target.bucketHash = digest;
		objectRepository.findByRemoteId.mockResolvedValue(target);
		objectRepository.findVerifiedBucketSourcesByRemoteIds.mockResolvedValue([
			{
				...createSource(),
				anchorKind: 'content-addressed-bucket',
				bucketHash: digest,
				objectUrl: `https://source.example/history/bucket/77/77/77/bucket-${digest}.xdr.gz`
			}
		]);
		artifactRepository.openVerifiedObject.mockResolvedValue({
			reason: 'remote-fetch-failed',
			retryAfterSeconds: 60,
			retryable: true,
			status: 'unavailable'
		});

		await expect(useCase.execute(createRequest())).resolves.toMatchObject({
			reason: 'remote-fetch-failed',
			status: 'unavailable'
		});
		expect(
			objectRepository.findVerifiedBucketSourcesByRemoteIds
		).toHaveBeenCalledWith([targetRemoteId], 5);
		expect(
			objectRepository.findVerifiedCheckpointObjectSources
		).not.toHaveBeenCalled();
		expect(artifactRepository.openVerifiedObject).toHaveBeenCalledWith(
			expect.objectContaining({
				contentDigest: digest,
				objectIdentity: `bucket:${digest}`
			})
		);
	});
});

function createRequest() {
	return {
		candidateRemoteId,
		contentDigest: digest,
		proofId: '41',
		proofEvaluatedAtMs: Date.parse('2026-07-19T00:01:00.000Z'),
		proofVersion: 7,
		targetRemoteId
	};
}

function createTarget(): HistoryArchiveObject {
	const target = new HistoryArchiveObject({
		archiveUrl: 'https://target.example/history',
		archiveUrlIdentity: 'https://target.example/history',
		checkpointLedger: 63,
		objectKey: 'transactions:0000003f',
		objectOrder: 63,
		objectType: 'transactions',
		objectUrl:
			'https://target.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz',
		remoteId: targetRemoteId,
		status: 'failed'
	});
	target.errorType = 'archive_http_error';
	target.errorMessage = 'Remote transaction archive file was not found';
	target.httpStatus = 404;
	return target;
}

function createSource() {
	return {
		anchorKind: 'target-digest' as const,
		archiveUrl: 'https://source.example/history',
		archiveUrlIdentity: 'https://source.example/history',
		candidateRemoteId,
		checkpointLedger: 63,
		contentDigest: digest,
		contentRepresentation: 'uncompressed-xdr' as const,
		corroboratingSourceCount: 1,
		objectUrl:
			'https://source.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz',
		proofEvaluatedAt: new Date('2026-07-19T00:01:00.000Z'),
		proofId: 41,
		proofVersion: 7,
		targetRemoteId,
		verifiedAt: new Date('2026-07-19T00:00:00.000Z')
	};
}
