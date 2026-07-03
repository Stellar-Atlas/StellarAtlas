import 'reflect-metadata';
import FbasAnalyzerService from '../FbasAnalyzerService.js';
import FbasAnalyzerFacade, { MergeBy } from '../FbasAnalyzerFacade.js';
import { LoggerMock } from '@core/services/__mocks__/LoggerMock.js';
import { AnalysisResult } from '../AnalysisResult.js';
import { mock } from 'jest-mock-extended';
import { FbasMergedByAnalyzer } from '../FbasMergedByAnalyzer.js';
import { ok } from 'neverthrow';
import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import NodeMeasurement from '@network-scan/domain/node/NodeMeasurement.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { FbasMapper } from '../FbasMapper.js';

describe('analyze fbas', () => {
	it('should analyze correctly', () => {
		const facade = mock<FbasAnalyzerFacade>();
		const fbasMergedByAnalyzer = mock<FbasMergedByAnalyzer>();

		const fbasAnalyzerService = new FbasAnalyzerService(
			facade,
			fbasMergedByAnalyzer,
			new LoggerMock()
		);

		facade.analyzeSymmetricTopTier.mockReturnValueOnce(
			ok({
				symmetric_top_tier: {
					threshold: 1,
					validators: ['A'],
					innerQuorumSets: null
				}
			})
		);

		facade.analyzeMinimalQuorums.mockReturnValueOnce(
			ok({
				quorum_intersection: true,
				result: [['A']],
				size: 1,
				min: 1
			})
		);

		fbasMergedByAnalyzer.execute.mockReturnValueOnce(
			ok({
				blockingSets: [['A']],
				blockingSetsCount: 1,
				blockingSetsFiltered: [['A', 'B']],
				blockingSetsFilteredCount: 1,
				blockingSetsMinSize: 1,
				blockingSetsFilteredMinSize: 2,
				splittingSets: [['A', 'B', 'C']],
				splittingSetsCount: 1,
				splittingSetsMinSize: 3,
				topTier: ['A'],
				topTierSize: 4
			})
		);

		fbasMergedByAnalyzer.execute.mockReturnValueOnce(
			ok({
				blockingSets: [['org-a']],
				blockingSetsCount: 1,
				blockingSetsFiltered: [['org-a', 'org-b']],
				blockingSetsFilteredCount: 1,
				blockingSetsMinSize: 5,
				blockingSetsFilteredMinSize: 6,
				splittingSets: [['org-c']],
				splittingSetsCount: 1,
				splittingSetsMinSize: 7,
				topTier: ['org-a'],
				topTierSize: 8
			})
		);

		fbasMergedByAnalyzer.execute.mockReturnValueOnce(
			ok({
				blockingSets: [['country-a']],
				blockingSetsCount: 1,
				blockingSetsFiltered: [['country-a', 'country-b']],
				blockingSetsFilteredCount: 1,
				blockingSetsMinSize: 9,
				blockingSetsFilteredMinSize: 10,
				splittingSets: [['country-c']],
				splittingSetsCount: 1,
				splittingSetsMinSize: 11,
				topTier: ['country-a'],
				topTierSize: 12
			})
		);

		fbasMergedByAnalyzer.execute.mockReturnValueOnce(
			ok({
				blockingSets: [['isp-a']],
				blockingSetsCount: 1,
				blockingSetsFiltered: [['isp-a', 'isp-b']],
				blockingSetsFilteredCount: 1,
				blockingSetsMinSize: 13,
				blockingSetsFilteredMinSize: 14,
				splittingSets: [['isp-c']],
				splittingSetsCount: 1,
				splittingSetsMinSize: 15,
				topTier: ['isp-a'],
				topTierSize: 16
			})
		);

		const node1 = createDummyNode();
		const node1Measurement = new NodeMeasurement(new Date(), node1);
		node1Measurement.isValidating = true;
		node1.addMeasurement(node1Measurement);
		const node2 = createDummyNode();

		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			new Date()
		);

		const result = fbasAnalyzerService.performAnalysis(
			[node1, node2],
			[organization]
		);

		expect(result.isOk()).toBeTruthy();
		if (result.isOk()) {
			const analysisResult: AnalysisResult = result.value;
			expect(analysisResult.hasSymmetricTopTier).toBeTruthy();
			expect(analysisResult.hasQuorumIntersection).toBeTruthy();
			expect(analysisResult.symmetricTopTier).toEqual({
				threshold: 1,
				validators: ['A'],
				innerQuorumSets: null
			});
			expect(analysisResult.minimalQuorums).toEqual({
				min: 1,
				quorumIntersection: true,
				result: [['A']],
				size: 1
			});
			expect(analysisResult.node.blockingSets).toEqual([['A']]);
			expect(analysisResult.node.blockingSetsFiltered).toEqual([['A', 'B']]);
			expect(analysisResult.node.splittingSets).toEqual([['A', 'B', 'C']]);
			expect(analysisResult.node.topTier).toEqual(['A']);
			expect(analysisResult.node.blockingSetsMinSize).toBe(1);
			expect(analysisResult.node.blockingSetsFilteredMinSize).toBe(2);
			expect(analysisResult.node.splittingSetsMinSize).toBe(3);
			expect(analysisResult.node.topTierSize).toBe(4);
			expect(analysisResult.organization.blockingSetsMinSize).toBe(5);
			expect(analysisResult.organization.blockingSetsFilteredMinSize).toBe(6);
			expect(analysisResult.organization.splittingSetsMinSize).toBe(7);
			expect(analysisResult.organization.topTierSize).toBe(8);
			expect(analysisResult.country.blockingSetsMinSize).toBe(9);
			expect(analysisResult.country.blockingSetsFilteredMinSize).toBe(10);
			expect(analysisResult.country.splittingSetsMinSize).toBe(11);
			expect(analysisResult.country.topTierSize).toBe(12);
			expect(analysisResult.isp.blockingSetsMinSize).toBe(13);
			expect(analysisResult.isp.blockingSetsFilteredMinSize).toBe(14);
			expect(analysisResult.isp.splittingSetsMinSize).toBe(15);
			expect(analysisResult.isp.topTierSize).toBe(16);
		}

		expect(fbasMergedByAnalyzer.execute).toHaveBeenCalledTimes(4);
		expect(fbasMergedByAnalyzer.execute).toHaveBeenCalledWith(
			[
				FbasMapper.mapToFbasAnalysisNode(node1),
				FbasMapper.mapToFbasAnalysisNode(node2)
			],
			[node2.publicKey.value],
			[FbasMapper.mapToFbasAnalysisOrganization(organization)],
			null
		);
		expect(fbasMergedByAnalyzer.execute).toHaveBeenCalledWith(
			[
				FbasMapper.mapToFbasAnalysisNode(node1),
				FbasMapper.mapToFbasAnalysisNode(node2)
			],
			[node2.publicKey.value],
			[FbasMapper.mapToFbasAnalysisOrganization(organization)],
			MergeBy.ORGANIZATION
		);
		expect(fbasMergedByAnalyzer.execute).toHaveBeenCalledWith(
			[
				FbasMapper.mapToFbasAnalysisNode(node1),
				FbasMapper.mapToFbasAnalysisNode(node2)
			],
			[node2.publicKey.value],
			[FbasMapper.mapToFbasAnalysisOrganization(organization)],
			MergeBy.COUNTRY
		);
		expect(fbasMergedByAnalyzer.execute).toHaveBeenCalledWith(
			[
				FbasMapper.mapToFbasAnalysisNode(node1),
				FbasMapper.mapToFbasAnalysisNode(node2)
			],
			[node2.publicKey.value],
			[FbasMapper.mapToFbasAnalysisOrganization(organization)],
			MergeBy.ISP
		);
	});
});
