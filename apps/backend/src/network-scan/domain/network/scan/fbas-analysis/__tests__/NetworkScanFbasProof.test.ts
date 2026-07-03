import type { AnalysisResult } from '../AnalysisResult.js';
import type { FbasMergedAnalysisProof } from '../FbasProofPayload.js';
import {
	maxFbasProofPayloadBytes,
	maxFbasProofSetMembers,
	maxFbasProofSetsPerFamily
} from '../FbasProofPayload.js';
import { NetworkScanFbasProof } from '../NetworkScanFbasProof.js';

describe('NetworkScanFbasProof', () => {
	it('should cap oversized proof families and mark the artifact incomplete', () => {
		const oversizedSets = Array.from(
			{ length: maxFbasProofSetsPerFamily + 2 },
			(_, index) => makeProofSet(`set-${index}`)
		);
		const analysisResult = makeAnalysisResult({
			node: {
				...makeMergedAnalysisProof('node'),
				blockingSets: oversizedSets,
				blockingSetsCount: oversizedSets.length,
				blockingSetsMinSize: maxFbasProofSetMembers + 2
			}
		});

		const proof = NetworkScanFbasProof.fromAnalysisResult(
			new Date('2026-07-03T12:00:00.000Z'),
			analysisResult
		);

		expect(proof.payload.complete).toBe(false);
		expect(proof.payload.node.blockingSets.complete).toBe(false);
		expect(proof.payload.node.blockingSets.capturedCount).toBe(
			maxFbasProofSetsPerFamily
		);
		expect(proof.payload.node.blockingSets.sets[0]).toHaveLength(
			maxFbasProofSetMembers
		);
		expect(proof.payloadBytes).toBeGreaterThan(0);
		expect(proof.payloadBytes).toBeLessThanOrEqual(maxFbasProofPayloadBytes);
	});
});

function makeAnalysisResult(
	overrides: Partial<AnalysisResult> = {}
): AnalysisResult {
	return {
		country: makeMergedAnalysisProof('country'),
		hasQuorumIntersection: true,
		hasSymmetricTopTier: true,
		isp: makeMergedAnalysisProof('isp'),
		minimalQuorums: {
			min: 1,
			quorumIntersection: true,
			result: [['A']],
			size: 1
		},
		node: makeMergedAnalysisProof('node'),
		organization: makeMergedAnalysisProof('organization'),
		symmetricTopTier: {
			innerQuorumSets: null,
			threshold: 1,
			validators: ['A']
		},
		...overrides
	};
}

function makeMergedAnalysisProof(label: string): FbasMergedAnalysisProof {
	return {
		blockingSets: [[`${label}-blocking`]],
		blockingSetsCount: 1,
		blockingSetsFiltered: [[`${label}-blocking-filtered`]],
		blockingSetsFilteredCount: 1,
		blockingSetsFilteredMinSize: 1,
		blockingSetsMinSize: 1,
		splittingSets: [[`${label}-splitting`]],
		splittingSetsCount: 1,
		splittingSetsMinSize: 1,
		topTier: [`${label}-top-tier`],
		topTierSize: 1
	};
}

function makeProofSet(label: string): string[] {
	return Array.from(
		{ length: maxFbasProofSetMembers + 2 },
		(_, index) => `${label}-member-${index}`
	);
}
