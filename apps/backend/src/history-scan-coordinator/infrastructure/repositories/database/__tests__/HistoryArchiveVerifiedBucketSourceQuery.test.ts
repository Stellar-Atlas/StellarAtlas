import type { EntityManager } from 'typeorm';
import {
	findVerifiedBucketSources,
	historyArchiveVerifiedBucketSourceSql
} from '../HistoryArchiveVerifiedBucketSourceQuery.js';

const targetRemoteId = '11111111-1111-4111-8111-111111111111';
const candidateRemoteId = '22222222-2222-4222-8222-222222222222';
const bucketHash = 'a'.repeat(64);
const publicResolver = async (): Promise<readonly string[]> => ['8.8.8.8'];

describe('HistoryArchiveVerifiedBucketSourceQuery', () => {
	it('maps a same-network bucket source bound to a strict checkpoint proof', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => [candidateRow()]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			findVerifiedBucketSources(
				manager,
				[targetRemoteId, targetRemoteId],
				99,
				publicResolver
			)
		).resolves.toEqual([
			{
				anchorKind: 'content-addressed-bucket',
				archiveUrl: 'https://copy.example.com/archive',
				archiveUrlIdentity: 'https://copy.example.com/archive',
				bucketHash,
				candidateRemoteId,
				checkpointLedger: 63,
				contentDigest: bucketHash,
				contentRepresentation: 'uncompressed-xdr',
				corroboratingSourceCount: 1,
				objectUrl: `https://copy.example.com/archive/bucket/aa/aa/aa/bucket-${bucketHash}.xdr.gz`,
				proofEvaluatedAt: new Date('2026-07-16T00:01:00.000Z'),
				proofId: 42,
				proofVersion: 7,
				targetRemoteId,
				verifiedAt: new Date('2026-07-16T00:00:00.000Z')
			}
		]);
		expect(query).toHaveBeenCalledWith(historyArchiveVerifiedBucketSourceSql, [
			[targetRemoteId],
			5
		]);
		expect(historyArchiveVerifiedBucketSourceSql).toContain(
			'history_archive_checkpoint_bucket_dependency'
		);
		expect(historyArchiveVerifiedBucketSourceSql).toContain(
			'proof."bucketsVerified" = true'
		);
		expect(historyArchiveVerifiedBucketSourceSql).toContain(
			'proof."evaluatedAt" >= candidate."verifiedAt"'
		);
		expect(historyArchiveVerifiedBucketSourceSql).toContain(
			'candidate_state."networkPassphrase" = target."networkPassphrase"'
		);
	});

	it('does not query without a failed target object', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => []);
		const manager = { query } as unknown as EntityManager;
		await expect(findVerifiedBucketSources(manager, [], 5)).resolves.toEqual(
			[]
		);
		expect(query).not.toHaveBeenCalled();
	});

	it('rejects a candidate URL outside its archive root', async () => {
		const manager = {
			query: jest.fn(async (): Promise<unknown[]> => [
				{
					...candidateRow(),
					objectUrl: `https://copy.example.com/other/bucket-${bucketHash}.xdr.gz`
				}
			])
		} as unknown as EntityManager;

		await expect(
			findVerifiedBucketSources(manager, [targetRemoteId], 5, publicResolver)
		).resolves.toEqual([]);
	});

	it('omits a candidate whose hostname resolves to a private address', async () => {
		const manager = {
			query: jest.fn(async (): Promise<unknown[]> => [candidateRow()])
		} as unknown as EntityManager;

		await expect(
			findVerifiedBucketSources(manager, [targetRemoteId], 5, async () => [
				'10.0.0.1'
			])
		).resolves.toEqual([]);
	});
});

function candidateRow(): Record<string, unknown> {
	return {
		archiveUrl: 'https://copy.example.com/archive',
		archiveUrlIdentity: 'https://copy.example.com/archive',
		bucketHash,
		candidateRemoteId,
		checkpointLedger: '63',
		objectUrl: `https://copy.example.com/archive/bucket/aa/aa/aa/bucket-${bucketHash}.xdr.gz`,
		proofEvaluatedAt: '2026-07-16T00:01:00.000Z',
		proofId: 42,
		proofVersion: '7',
		targetRemoteId,
		verifiedAt: '2026-07-16T00:00:00.000Z'
	};
}
