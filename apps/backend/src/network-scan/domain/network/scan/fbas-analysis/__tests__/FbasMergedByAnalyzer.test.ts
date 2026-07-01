import FbasAnalyzerFacade, {
	FbasAnalysisNode,
	FbasAnalysisOrganization,
	MergeBy
} from '../FbasAnalyzerFacade.js';
import { FbasMergedByAnalyzer } from '../FbasMergedByAnalyzer.js';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { ok } from 'neverthrow';

describe('FbasMergedByAnalyzer', () => {
	test('execute', () => {
		const fbasAnalysisNode: FbasAnalysisNode = {
			publicKey: 'A',
			geoData: null,
			isp: null,
			quorumSet: null,
			name: null
		};
		const fbasAnalysisOrganization: FbasAnalysisOrganization = {
			id: 'AA',
			name: 'A',
			validators: ['A']
		};
		const faultyNodes = ['B'];

		const analyzerFacade = mock<FbasAnalyzerFacade>();
		analyzerFacade.analyzeBlockingSets.mockReturnValueOnce(
			ok({
				min: 2,
				size: 3,
				result: [['A', 'B', 'C']]
			})
		);

		//filtered
		analyzerFacade.analyzeBlockingSets.mockReturnValueOnce(
			ok({
				min: 3,
				size: 3,
				result: [['A', 'B', 'C']]
			})
		);
		analyzerFacade.analyzeSplittingSets.mockReturnValue(
			ok({
				min: 4,
				size: 5,
				result: [['A', 'B', 'C']]
			})
		);
		analyzerFacade.analyzeTopTier.mockReturnValue(
			ok({
				top_tier: ['A', 'B', 'C'],
				cache_hit: false,
				top_tier_size: 6
			})
		);
		const analyzer = new FbasMergedByAnalyzer(analyzerFacade, mock<Logger>());
		const result = analyzer.execute(
			[fbasAnalysisNode],
			faultyNodes,
			[fbasAnalysisOrganization],
			MergeBy.ORGANIZATION
		);

		expect(result.isOk()).toBeTruthy();
		if (result.isOk()) {
			expect(result.value).toEqual({
				blockingSetsFilteredMinSize: 3,
				blockingSetsMinSize: 2,
				splittingSetsMinSize: 4,
				topTierSize: 6
			});
		}

		expect(analyzerFacade.analyzeBlockingSets).toHaveBeenCalledTimes(2);
		expect(analyzerFacade.analyzeBlockingSets).toHaveBeenCalledWith(
			[fbasAnalysisNode],
			faultyNodes,
			[fbasAnalysisOrganization],
			MergeBy.ORGANIZATION
		);
		expect(analyzerFacade.analyzeBlockingSets).toHaveBeenCalledWith(
			[fbasAnalysisNode],
			[],
			[fbasAnalysisOrganization],
			MergeBy.ORGANIZATION
		);
		expect(analyzerFacade.analyzeSplittingSets).toHaveBeenCalledTimes(1);
		expect(analyzerFacade.analyzeSplittingSets).toHaveBeenCalledWith(
			[fbasAnalysisNode],
			[fbasAnalysisOrganization],
			MergeBy.ORGANIZATION
		);
		expect(analyzerFacade.analyzeTopTier).toHaveBeenCalledTimes(1);
		expect(analyzerFacade.analyzeTopTier).toHaveBeenCalledWith(
			[fbasAnalysisNode],
			[fbasAnalysisOrganization],
			MergeBy.ORGANIZATION
		);
	});
});
