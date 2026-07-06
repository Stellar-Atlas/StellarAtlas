import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { HistoryArchiveStateSnapshot } from '../../history-archive-state/HistoryArchiveStateSnapshot.js';
import {
	buildCheckpointStateDiscoveryObjects,
	buildCheckpointSiblingObjectsFromState,
	buildHistoryArchiveObjectsFromState,
	buildRootHistoryArchiveObject
} from '../HistoryArchiveObjectBuilder.js';

describe('HistoryArchiveObjectBuilder', () => {
	it('derives host identity while preserving root archive identity', () => {
		const root = buildRootHistoryArchiveObject(
			'https://history.example.com/archive-a'
		);

		expect(root).toMatchObject({
			archiveUrlIdentity: 'https://history.example.com/archive-a',
			hostIdentity: 'history.example.com',
			objectKey: 'root'
		});
	});

	it('builds state-derived objects with shared host and distinct archive identity', () => {
		const objects = buildHistoryArchiveObjectsFromState(
			HistoryArchiveStateSnapshot.available(
				'https://history.example.com/archive-b',
				'https://history.example.com/archive-b',
				createArchiveMetadata(),
				'history-scanner'
			)
		);

		expect(objects.length).toBeGreaterThan(1);
		expect(new Set(objects.map((object) => object.hostIdentity))).toEqual(
			new Set(['history.example.com'])
		);
		expect(new Set(objects.map((object) => object.archiveUrlIdentity))).toEqual(
			new Set(['https://history.example.com/archive-b'])
		);
	});

	it('discovers checkpoint state objects backwards from latest state', () => {
		const objects = buildCheckpointStateDiscoveryObjects(
			createSnapshot(createArchiveMetadata(255)),
			{ maxObjects: 3 }
		);

		expect(objects.map((object) => object.objectKey)).toEqual([
			'checkpoint-state:000000ff',
			'checkpoint-state:000000bf',
			'checkpoint-state:0000007f'
		]);
		expect(objects.map((object) => object.objectUrl)).toEqual([
			'https://history.example.com/archive-b/history/00/00/00/history-000000ff.json',
			'https://history.example.com/archive-b/history/00/00/00/history-000000bf.json',
			'https://history.example.com/archive-b/history/00/00/00/history-0000007f.json'
		]);
	});

	it('continues checkpoint discovery older than the oldest already scheduled checkpoint', () => {
		const objects = buildCheckpointStateDiscoveryObjects(
			createSnapshot(createArchiveMetadata(255)),
			{
				maxObjects: 3,
				oldestScheduledCheckpointLedger: 191
			}
		);

		expect(objects.map((object) => object.objectKey)).toEqual([
			'checkpoint-state:0000007f',
			'checkpoint-state:0000003f'
		]);
	});

	it('builds checkpoint sibling objects without creating a root state object', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(createArchiveMetadata(127))
		);

		expect(objects.map((object) => object.objectKey)).toEqual([
			'ledger:0000007f',
			'transactions:0000007f',
			'results:0000007f',
			'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655'
		]);
		expect(objects.map((object) => object.objectType)).not.toContain(
			'history-archive-state'
		);
	});

	it('does not build checkpoint siblings from mismatched checkpoint state', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(createArchiveMetadata(127)),
			{ expectedCheckpointLedger: 191 }
		);

		expect(objects).toEqual([]);
	});

	it('builds scp sibling objects for modern checkpoints', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(createArchiveMetadata(1_214_079))
		);

		expect(objects.map((object) => object.objectKey)).toContain('scp:0012867f');
		expect(
			objects.find((object) => object.objectKey === 'scp:0012867f')?.objectUrl
		).toBe(
			'https://history.example.com/archive-b/scp/00/12/86/scp-0012867f.xdr.gz'
		);
	});

	it('skips the public network scp history gap before the first scp checkpoint', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(
				createArchiveMetadata(1_214_015, {
					networkPassphrase: 'Public Global Stellar Network ; September 2015'
				})
			)
		);

		expect(objects.map((object) => object.objectType)).not.toContain('scp');
	});

	it('builds early scp objects when a non-public network explicitly reports them', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(
				createArchiveMetadata(1_214_015, {
					networkPassphrase: 'Test SDF Network ; September 2015'
				})
			)
		);

		expect(objects.map((object) => object.objectKey)).toContain('scp:0012863f');
	});

	it('deduplicates bucket objects found in checkpoint state buckets', () => {
		const objects = buildCheckpointSiblingObjectsFromState(
			createSnapshot(createArchiveMetadataWithDuplicateBuckets(127))
		);

		expect(
			objects.filter((object) => object.objectType === 'bucket')
		).toHaveLength(1);
	});
});

function createSnapshot(
	archiveMetadata: ArchiveMetadataDTO
): HistoryArchiveStateSnapshot {
	return HistoryArchiveStateSnapshot.available(
		'https://history.example.com/archive-b',
		'https://history.example.com/archive-b',
		archiveMetadata,
		'history-scanner'
	);
}

function createArchiveMetadata(
	currentLedger = 63354047,
	options: { readonly networkPassphrase?: string | null } = {}
): ArchiveMetadataDTO {
	return {
		observedAt: '2026-07-06T14:30:00.000Z',
		stellarHistory: {
			currentBuckets: [
				{
					curr: '4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
					next: { state: 0 },
					snap: '0000000000000000000000000000000000000000000000000000000000000000'
				}
			],
			currentLedger,
			networkPassphrase: options.networkPassphrase,
			server: 'stellar-core',
			version: 1
		},
		stellarHistoryUrl:
			'https://history.example.com/archive-b/.well-known/stellar-history.json'
	};
}

function createArchiveMetadataWithDuplicateBuckets(
	currentLedger: number
): ArchiveMetadataDTO {
	const bucketHash =
		'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

	return {
		observedAt: '2026-07-06T14:30:00.000Z',
		stellarHistory: {
			currentBuckets: [
				{
					curr: bucketHash,
					next: { output: bucketHash, state: 1 },
					snap: bucketHash
				}
			],
			currentLedger,
			hotArchiveBuckets: [
				{
					curr: bucketHash,
					next: { output: bucketHash, state: 1 },
					snap: bucketHash
				}
			],
			server: 'stellar-core',
			version: 1
		},
		stellarHistoryUrl:
			'https://history.example.com/archive-b/history/00/00/00/history-0000007f.json'
	};
}
