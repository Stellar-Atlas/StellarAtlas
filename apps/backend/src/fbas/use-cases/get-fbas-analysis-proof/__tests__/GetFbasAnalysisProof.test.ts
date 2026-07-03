import { mock, type MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import type { NetworkScanFbasProofRepository } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProofRepository.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetFbasAnalysisProof } from '../GetFbasAnalysisProof.js';

describe('GetFbasAnalysisProof', () => {
	let networkScanRepository: MockProxy<NetworkScanRepository>;
	let fbasProofRepository: MockProxy<NetworkScanFbasProofRepository>;
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let getFbasAnalysisProof: GetFbasAnalysisProof;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepository = mock<NetworkScanRepository>();
		fbasProofRepository = mock<NetworkScanFbasProofRepository>();
		exceptionLogger = mock<ExceptionLogger>();
		getFbasAnalysisProof = new GetFbasAnalysisProof(
			networkScanRepository,
			fbasProofRepository,
			exceptionLogger
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose persisted proof evidence for a completed scan', async () => {
		networkScanRepository.findCompletedById.mockResolvedValue(makeScan());
		const proof = makeProof();
		fbasProofRepository.findByScanId.mockResolvedValue(proof);

		const result = await getFbasAnalysisProof.execute({ scanId: 42 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			evidenceSelection: 'network_scan_fbas_proof',
			proofSetPersistence: 'persisted',
			scanId: 42,
			scanTime: '2026-07-03T11:56:00.000Z',
			schemaVersion: 1,
			payloadBytes: proof.payloadBytes,
			proof: proof.payload
		});
		expect(networkScanRepository.findCompletedById).toHaveBeenCalledWith(42);
		expect(fbasProofRepository.findByScanId).toHaveBeenCalledWith(42);
	});

	it('should return null when the completed scan does not exist', async () => {
		networkScanRepository.findCompletedById.mockResolvedValue(undefined);

		const result = await getFbasAnalysisProof.execute({ scanId: 42 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(fbasProofRepository.findByScanId).not.toHaveBeenCalled();
	});

	it('should return null when the scan has no persisted proof artifact', async () => {
		networkScanRepository.findCompletedById.mockResolvedValue(makeScan());
		fbasProofRepository.findByScanId.mockResolvedValue(null);

		const result = await getFbasAnalysisProof.execute({ scanId: 42 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should reject invalid scan ids', async () => {
		const result = await getFbasAnalysisProof.execute({ scanId: 0 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'scanId must be a positive 32-bit integer'
		);
		expect(networkScanRepository.findCompletedById).not.toHaveBeenCalled();
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkScanRepository.findCompletedById.mockRejectedValue(error);

		const result = await getFbasAnalysisProof.execute({ scanId: 42 });

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
	const proof = new NetworkScanFbasProof(new Date('2026-07-03T11:56:00.000Z'), {
		complete: true,
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
		node: makeMergedProofArtifact('node'),
		organization: makeMergedProofArtifact('organization'),
		symmetricTopTier: {
			complete: true,
			innerQuorumSets: null,
			innerQuorumSetsCaptureLimit: 16,
			threshold: 1,
			validators: makeMembershipCapture('validator')
		},
		version: 1
	});
	proof.scanId = 42;
	proof.schemaVersion = 1;
	return proof;
}

function makeMergedProofArtifact(label: string) {
	return {
		blockingSets: makeProofSetFamily(`${label}-blocking`),
		blockingSetsFiltered: makeProofSetFamily(`${label}-blocking-filtered`),
		splittingSets: makeProofSetFamily(`${label}-splitting`),
		topTier: makeMembershipCapture(`${label}-top-tier`)
	};
}

function makeProofSetFamily(label: string) {
	return {
		captureLimit: 32,
		capturedCount: 1,
		complete: true,
		memberLimit: 32,
		minSize: 1,
		sets: [[label]],
		totalCount: 1
	};
}

function makeMembershipCapture(label: string) {
	return {
		captureLimit: 32,
		capturedCount: 1,
		complete: true,
		members: [label],
		totalCount: 1
	};
}
