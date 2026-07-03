import { mock, type MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import type {
	FbasMergedProofArtifact,
	FbasProofPayload,
	FbasProofSetFamily
} from '@network-scan/domain/network/scan/fbas-analysis/FbasProofPayload.js';
import type { NetworkScanFbasProofRepository } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProofRepository.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetLatestFbasProofSets } from '../GetLatestFbasProofSets.js';

describe('GetLatestFbasProofSets', () => {
	let networkScanRepository: MockProxy<NetworkScanRepository>;
	let fbasProofRepository: MockProxy<NetworkScanFbasProofRepository>;
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let getLatestFbasProofSets: GetLatestFbasProofSets;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepository = mock<NetworkScanRepository>();
		fbasProofRepository = mock<NetworkScanFbasProofRepository>();
		exceptionLogger = mock<ExceptionLogger>();
		getLatestFbasProofSets = new GetLatestFbasProofSets(
			networkScanRepository,
			fbasProofRepository,
			exceptionLogger
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose latest persisted blocking-set evidence', async () => {
		networkScanRepository.findLatest.mockResolvedValue(makeScan());
		const proof = makeProof();
		fbasProofRepository.findByScanId.mockResolvedValue(proof);

		const result = await getLatestFbasProofSets.execute({
			kind: 'blocking_sets'
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			evidenceSelection: 'latest_network_scan_fbas_proof',
			proofSetPersistence: 'persisted',
			setType: 'blocking_sets',
			scanId: 42,
			scanTime: '2026-07-03T11:56:00.000Z',
			schemaVersion: 1,
			payloadBytes: proof.payloadBytes,
			complete: false,
			node: {
				blockingSets: proof.payload.node.blockingSets,
				blockingSetsFiltered: proof.payload.node.blockingSetsFiltered
			}
		});
		expect(fbasProofRepository.findByScanId).toHaveBeenCalledWith(42);
	});

	it('should expose latest persisted splitting-set evidence', async () => {
		networkScanRepository.findLatest.mockResolvedValue(makeScan());
		const proof = makeProof();
		fbasProofRepository.findByScanId.mockResolvedValue(proof);

		const result = await getLatestFbasProofSets.execute({
			kind: 'splitting_sets'
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			evidenceSelection: 'latest_network_scan_fbas_proof',
			proofSetPersistence: 'persisted',
			setType: 'splitting_sets',
			scanId: 42,
			complete: true,
			node: {
				splittingSets: proof.payload.node.splittingSets
			}
		});
	});

	it('should return null when no latest completed scan exists', async () => {
		networkScanRepository.findLatest.mockResolvedValue(undefined);

		const result = await getLatestFbasProofSets.execute({
			kind: 'blocking_sets'
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(fbasProofRepository.findByScanId).not.toHaveBeenCalled();
	});

	it('should return null when the latest scan has no proof row', async () => {
		networkScanRepository.findLatest.mockResolvedValue(makeScan());
		fbasProofRepository.findByScanId.mockResolvedValue(null);

		const result = await getLatestFbasProofSets.execute({
			kind: 'splitting_sets'
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkScanRepository.findLatest.mockRejectedValue(error);

		const result = await getLatestFbasProofSets.execute({
			kind: 'blocking_sets'
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});

function makeScan(): NetworkScan {
	const scan = new NetworkScan(new Date('2026-07-03T11:56:00.000Z'));
	scan.id = 42;
	scan.completed = true;
	return scan;
}

function makeProof(): NetworkScanFbasProof {
	const proof = new NetworkScanFbasProof(
		new Date('2026-07-03T11:56:00.000Z'),
		makePayload()
	);
	proof.scanId = 42;
	return proof;
}

function makePayload(): FbasProofPayload {
	return {
		complete: false,
		country: makeMergedProofArtifact('country'),
		hasQuorumIntersection: true,
		hasSymmetricTopTier: true,
		isp: makeMergedProofArtifact('isp'),
		limits: {
			proofSetMembers: 32,
			proofSetsPerFamily: 32,
			symmetricTopTierDepth: 4,
			symmetricTopTierInnerSets: 16,
			topTierMembers: 512
		},
		minimalQuorums: {
			quorumIntersection: true,
			quorums: makeProofSetFamily('quorum')
		},
		node: makeMergedProofArtifact('node', false),
		organization: makeMergedProofArtifact('organization'),
		symmetricTopTier: null,
		version: 1
	};
}

function makeMergedProofArtifact(
	label: string,
	blockingComplete = true
): FbasMergedProofArtifact {
	return {
		blockingSets: makeProofSetFamily(`${label}-blocking`, blockingComplete),
		blockingSetsFiltered: makeProofSetFamily(`${label}-blocking-filtered`),
		splittingSets: makeProofSetFamily(`${label}-splitting`),
		topTier: {
			captureLimit: 32,
			capturedCount: 1,
			complete: true,
			members: [`${label}-top-tier`],
			totalCount: 1
		}
	};
}

function makeProofSetFamily(
	label: string,
	complete = true
): FbasProofSetFamily {
	return {
		captureLimit: 32,
		capturedCount: 1,
		complete,
		memberLimit: 32,
		minSize: 1,
		sets: [[label]],
		totalCount: 1
	};
}
