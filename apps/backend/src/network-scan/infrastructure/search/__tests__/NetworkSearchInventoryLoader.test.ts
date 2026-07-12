import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import type { GetKnownNodes } from '@network-scan/use-cases/get-known-nodes/GetKnownNodes.js';
import type { GetKnownOrganizations } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizations.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { NetworkSearchInventoryLoader } from '../NetworkSearchInventoryLoader.js';
import type { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { KnownArchiveEvidenceV1 } from 'shared';

describe('NetworkSearchInventoryLoader', () => {
	it('coalesces concurrent canonical reads and reuses the bounded cache', async () => {
		const getNetwork = mock<GetNetwork>();
		const getKnownNodes = mock<GetKnownNodes>();
		const getKnownOrganizations = mock<GetKnownOrganizations>();
		const getKnownArchiveEvidence = mock<GetKnownArchiveEvidence>();
		const network = createDummyNetworkV1([], []);
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
		expect(getNetwork.execute).toHaveBeenCalledTimes(1);
		expect(getKnownNodes.executeAll).toHaveBeenCalledTimes(1);
		expect(getKnownOrganizations.executeAll).toHaveBeenCalledTimes(1);
	});
});

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
