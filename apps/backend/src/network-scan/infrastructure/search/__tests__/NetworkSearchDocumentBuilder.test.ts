import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { buildNetworkSearchSnapshot } from '../NetworkSearchDocumentBuilder.js';
import type { NetworkSearchInventory } from '../NetworkSearchTypes.js';

describe('NetworkSearchDocumentBuilder archive status', () => {
	it('does not treat a legacy range error as current archive health', () => {
		const node = createDummyNodeV1('GA_LEGACY_RANGE_ERROR');
		node.historyUrl = 'https://history.example.org';
		node.historyArchiveHasError = true;

		expect(nodeDocument(createInventory(node)).archiveStatus).toBe('unknown');
	});

	it('uses current canonical object failures for node archive health', () => {
		const node = createDummyNodeV1('GA_CURRENT_OBJECT_FAILURE');
		node.historyUrl = 'https://history.example.org';
		node.historyArchiveHasError = false;
		const inventory = createInventory(node);

		expect(
			nodeDocument({
				...inventory,
				archiveRoots: [archiveRoot(node.publicKey)]
			}).archiveStatus
		).toBe('error');
	});

	it('requires a verified checkpoint before reporting healthy archive evidence', () => {
		const node = createDummyNodeV1('GA_CURRENT_CHECKPOINT_PROOF');
		node.historyUrl = 'https://history.example.org';
		const verifiedRoot = archiveRoot(node.publicKey);

		expect(
			nodeDocument({
				...createInventory(node),
				archiveRoots: [
					{
						...verifiedRoot,
						checkpoints: {
							...verifiedRoot.checkpoints,
							verifiedCheckpoints: 0
						},
						objects: {
							...verifiedRoot.objects,
							remoteFailureObjects: 0
						}
					}
				]
			}).archiveStatus
		).toBe('unknown');

		expect(
			nodeDocument({
				...createInventory(node),
				archiveRoots: [
					{
						...verifiedRoot,
						objects: {
							...verifiedRoot.objects,
							remoteFailureObjects: 0
						}
					}
				]
			}).archiveStatus
		).toBe('ok');
	});
});

function createInventory(
	node: ReturnType<typeof createDummyNodeV1>
): NetworkSearchInventory {
	const network = createDummyNetworkV1([node], []);
	network.time = '2026-07-13T00:00:00.000Z';
	network.latestLedger = '63400000';
	return {
		archiveRoots: [],
		generatedAt: '2026-07-13T00:00:01.000Z',
		network,
		nodes: [
			{
				current: true,
				dateDiscovered: '2026-07-01T00:00:00.000Z',
				lastMeasurementAt: node.dateUpdated,
				lastSeen: node.dateUpdated,
				metadataState: 'snapshot',
				node,
				publicKey: node.publicKey,
				scope: 'current-validator',
				snapshotEndDate: null,
				snapshotStartDate: '2026-07-01T00:00:00.000Z'
			}
		],
		organizations: []
	};
}

function archiveRoot(
	publicKey: string
): NetworkSearchInventory['archiveRoots'][number] {
	return {
		archiveUrl: 'https://history.example.org',
		archiveUrlIdentity: 'https://history.example.org',
		checkpoints: {
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0,
			pendingCheckpoints: 0,
			totalCheckpoints: 1,
			verifiedCheckpoints: 1
		},
		latestObjectAt: '2026-07-13T00:00:00.000Z',
		nodePublicKeys: [publicKey],
		objects: {
			activeObjects: 0,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 1,
			totalObjects: 2,
			verifiedBucketObjects: 0,
			verifiedObjects: 1,
			workerIssueObjects: 0
		},
		scannerOwnedState: null
	};
}

function nodeDocument(inventory: NetworkSearchInventory) {
	const document = buildNetworkSearchSnapshot(inventory).documents.find(
		(candidate) => candidate.entityType === 'node'
	);
	if (!document) throw new Error('Expected node search document');
	return document;
}
