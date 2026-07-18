import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import type { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import type { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { NetworkSearchInventoryLoader } from '../NetworkSearchInventoryLoader.js';
import type { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { KnownArchiveEvidenceV1 } from 'shared';
import type { NetworkSearchCanonicalArchiveSource } from '../NetworkSearchCanonicalArchiveSource.js';

describe('NetworkSearchInventoryLoader', () => {
	it('coalesces concurrent reads but refreshes the next canonical load', async () => {
		const getNetwork = mock<GetNetwork>();
		const getKnownNodes = mock<GetKnownNodes>();
		const getKnownOrganizations = mock<GetKnownOrganizations>();
		const getKnownArchiveEvidence = mock<GetKnownArchiveEvidence>();
		const canonicalArchiveSource = mock<NetworkSearchCanonicalArchiveSource>();
		const network = createDummyNetworkV1([], []);
		canonicalArchiveSource.load.mockResolvedValue({
			revision: 'archive-revision',
			roots: []
		});
		getNetwork.execute.mockResolvedValue(ok(network));
		getKnownNodes.executeAll.mockResolvedValue(
			ok({
				count: 0,
				generatedAt: network.time,
				nodes: [],
				scopeTotals: {
					'all-known': 0,
					archived: 0,
					'current-validator': 0,
					listener: 0,
					'public-key-only': 0
				},
				source: 'postgres_canonical'
			})
		);
		getKnownOrganizations.executeAll.mockResolvedValue(
			ok({
				count: 0,
				generatedAt: network.time,
				organizations: [],
				scopeTotals: { 'all-known': 0, archived: 0, current: 0 },
				source: 'postgres_canonical'
			})
		);
		getKnownArchiveEvidence.execute.mockResolvedValue(
			ok(emptyEvidence(network.time))
		);
		const loader = new NetworkSearchInventoryLoader({
			canonicalArchiveSource,
			getKnownArchiveEvidence,
			getKnownNodes,
			getKnownOrganizations,
			getNetwork
		});

		const [first, second] = await Promise.all([loader.load(), loader.load()]);
		const third = await loader.load();

		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(third.isOk()).toBe(true);
		expect(getNetwork.execute).toHaveBeenCalledTimes(2);
		expect(getKnownNodes.executeAll).toHaveBeenCalledTimes(2);
		expect(getKnownOrganizations.executeAll).toHaveBeenCalledTimes(2);
		expect(canonicalArchiveSource.load).toHaveBeenCalledTimes(2);
	});

	it('loads canonical archive roots without retained node ownership', async () => {
		const getNetwork = mock<GetNetwork>();
		const getKnownNodes = mock<GetKnownNodes>();
		const getKnownOrganizations = mock<GetKnownOrganizations>();
		const getKnownArchiveEvidence = mock<GetKnownArchiveEvidence>();
		const canonicalArchiveSource = mock<NetworkSearchCanonicalArchiveSource>();
		const network = createDummyNetworkV1([], []);
		const orphanUrl = 'https://orphan-history.example.org';
		const evidence = emptyEvidence(network.time);
		const orphanRoot: KnownArchiveEvidenceV1['roots'][number] = {
			archiveUrl: orphanUrl,
			archiveUrlIdentity: orphanUrl,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 1,
				verifiedCheckpoints: 1
			},
			latestObjectAt: network.time,
			nodePublicKeys: [],
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
			scannerOwnedState: null
		};
		canonicalArchiveSource.load.mockResolvedValue({
			revision: 'orphan-revision',
			roots: [{ archiveUrl: orphanUrl, archiveUrlIdentity: orphanUrl }]
		});
		getNetwork.execute.mockResolvedValue(ok(network));
		getKnownNodes.executeAll.mockResolvedValue(ok(emptyNodes(network.time)));
		getKnownOrganizations.executeAll.mockResolvedValue(
			ok(emptyOrganizations(network.time))
		);
		getKnownArchiveEvidence.execute.mockResolvedValue(
			ok({
				...evidence,
				roots: [orphanRoot],
				totals: { ...evidence.totals, archiveRoots: 1 }
			})
		);
		const loader = new NetworkSearchInventoryLoader({
			canonicalArchiveSource,
			getKnownArchiveEvidence,
			getKnownNodes,
			getKnownOrganizations,
			getNetwork
		});

		const result = await loader.load();

		if (result.isErr() || result.value === null) {
			throw new Error('Expected canonical search inventory');
		}
		expect(result.value.archiveRoots).toEqual([orphanRoot]);
		expect(result.value.canonicalArchiveRevision).toBe('orphan-revision');
		expect(getKnownArchiveEvidence.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				roots: [
					{
						archiveUrl: orphanUrl,
						archiveUrlIdentity: orphanUrl,
						nodePublicKeys: []
					}
				]
			})
		);
	});
});

function emptyNodes(at: string) {
	return {
		count: 0,
		generatedAt: at,
		nodes: [],
		scopeTotals: {
			'all-known': 0,
			archived: 0,
			'current-validator': 0,
			listener: 0,
			'public-key-only': 0
		},
		source: 'postgres_canonical' as const
	};
}

function emptyOrganizations(at: string) {
	return {
		count: 0,
		generatedAt: at,
		organizations: [],
		scopeTotals: { 'all-known': 0, archived: 0, current: 0 },
		source: 'postgres_canonical' as const
	};
}

function emptyEvidence(at: string): KnownArchiveEvidenceV1 {
	const page = {
		hasMore: false,
		limit: 1,
		nextCursor: null,
		snapshotAt: at,
		total: 0
	};
	const failureFilters = { archiveUrlIdentity: null, objectType: null };
	const objectCounts = {
		activeObjects: 0,
		bucketObjects: 0,
		pendingObjects: 0,
		remoteFailureObjects: 0,
		totalObjects: 0,
		verifiedBucketObjects: 0,
		verifiedObjects: 0,
		workerIssueObjects: 0
	};
	const checkpointCounts = {
		mismatchedCheckpoints: 0,
		notEvaluableCheckpoints: 0,
		pendingCheckpoints: 0,
		totalCheckpoints: 0,
		verifiedCheckpoints: 0
	};
	return {
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: null,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page
		},
		generatedAt: at,
		nodePublicKeys: [],
		objectPage: {
			filters: { ...failureFilters, status: null },
			objects: [],
			page
		},
		remoteFailures: { ...page, failures: [], filters: failureFilters },
		roots: [],
		totals: {
			archiveRoots: 0,
			checkpoints: checkpointCounts,
			nodes: 0,
			objects: objectCounts
		},
		workerIssues: { ...page, filters: failureFilters, issues: [] }
	};
}
