import type { EntityManager } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	findKnownArchiveCopyCoverage,
	knownArchiveCopyCoverageSql
} from '../KnownArchiveCopyCoverageQuery.js';

describe('KnownArchiveCopyCoverageQuery', () => {
	it('loads same-organization and other-network copies in one bounded query', async () => {
		const sourceA = createSource(
			'https://history-a.example.com',
			'11111111-1111-4111-8111-111111111111'
		);
		const sourceB = createSource(
			'https://history-b.example.com',
			'22222222-2222-4222-8222-222222222222'
		);
		const query = jest.fn(async () => [
			{
				archiveUrl: 'https://history-b.example.com',
				archiveUrlIdentity: 'https://history-b.example.com',
				copyCount: '1',
				objectUrl:
					'https://history-b.example.com/Bucket/AA/Object.xdr.gz?token=AbC',
				relation: 'same-organization',
				remoteId: '33333333-3333-4333-8333-333333333333',
				sourceRemoteId: sourceA.remoteId,
				verifiedAt: '2026-07-10T00:00:00.000Z'
			},
			{
				archiveUrl: 'https://network.example.com',
				archiveUrlIdentity: 'https://network.example.com',
				copyCount: '5',
				objectUrl: 'https://network.example.com/bucket/object.xdr.gz',
				relation: 'network',
				remoteId: '44444444-4444-4444-8444-444444444444',
				sourceRemoteId: sourceA.remoteId,
				verifiedAt: '2026-07-10T00:01:00.000Z'
			}
		]);
		const manager = { query } as unknown as EntityManager;
		const snapshotAt = new Date('2026-07-10T01:00:00.000Z');

		const result = await findKnownArchiveCopyCoverage(
			manager,
			[sourceA, sourceB],
			[sourceA.archiveUrlIdentity, sourceB.archiveUrlIdentity],
			3,
			snapshotAt
		);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(knownArchiveCopyCoverageSql, [
			[sourceA.remoteId, sourceB.remoteId],
			[sourceA.archiveUrlIdentity, sourceB.archiveUrlIdentity],
			3,
			snapshotAt
		]);
		expect(result).toMatchObject([
			{
				network: {
					count: 5,
					copies: [{ archiveUrlIdentity: 'https://network.example.com' }]
				},
				sameOrganization: {
					count: 1,
					copies: [
						{
							archiveUrlIdentity: 'https://history-b.example.com',
							objectUrl:
								'https://history-b.example.com/Bucket/AA/Object.xdr.gz?token=AbC'
						}
					]
				},
				sourceRemoteId: sourceA.remoteId
			},
			{
				network: { count: 0, copies: [] },
				sameOrganization: { count: 0, copies: [] },
				sourceRemoteId: sourceB.remoteId
			}
		]);
		expect(knownArchiveCopyCoverageSql).toContain('row_number() over');
		expect(knownArchiveCopyCoverageSql).toContain('where sample_rank <= $3');
		expect(knownArchiveCopyCoverageSql).toContain(
			'copy."networkPassphrase" = source."networkPassphrase"'
		);
		expect(knownArchiveCopyCoverageSql).toContain("-> 'content' ->> 'digest'");
		expect(knownArchiveCopyCoverageSql).toContain('source."objectType" in (');
		expect(knownArchiveCopyCoverageSql).toContain(
			'copy."checkpointLedger" = source."checkpointLedger"'
		);
		expect(knownArchiveCopyCoverageSql).not.toContain(
			"source.\"objectType\" in ('history-archive-state', 'scp')"
		);
	});

	it('rejects a persisted copy URL outside the public HTTP contract', async () => {
		const source = createSource(
			'https://history-a.example.com',
			'11111111-1111-4111-8111-111111111111'
		);
		const manager = {
			query: jest.fn(async () => [
				{
					archiveUrl: 'https://copy.example.com',
					archiveUrlIdentity: 'https://copy.example.com',
					copyCount: '1',
					objectUrl: 'file:///tmp/private-bucket.xdr.gz',
					relation: 'network',
					remoteId: '44444444-4444-4444-8444-444444444444',
					sourceRemoteId: source.remoteId,
					verifiedAt: '2026-07-10T00:01:00.000Z'
				}
			])
		} as unknown as EntityManager;

		await expect(
			findKnownArchiveCopyCoverage(manager, [source], [], 3, new Date())
		).rejects.toThrow('invalid objectUrl');
	});
});

function createSource(
	archiveUrl: string,
	remoteId: string
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash:
			'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
		objectKey:
			'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/object.xdr.gz`,
		remoteId,
		status: 'failed'
	});
}
