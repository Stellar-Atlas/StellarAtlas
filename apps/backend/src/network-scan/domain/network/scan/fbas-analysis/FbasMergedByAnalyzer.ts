import FbasAnalyzerFacade, {
	FbasAnalysisNode,
	FbasAnalysisOrganization,
	MergeBy
} from './FbasAnalyzerFacade.js';
import { err, ok, Result } from 'neverthrow';
import { AnalysisMergedResult } from './AnalysisMergedResult.js';
import { inject, injectable } from 'inversify';
import type { Logger } from '@core/services/Logger.js';

//Perform all analysis on the FBAS merged by country, organization or...
@injectable()
export class FbasMergedByAnalyzer {
	constructor(
		private analysisFacade: FbasAnalyzerFacade,
		@inject('Logger') private logger: Logger
	) {}

	public execute(
		nodes: FbasAnalysisNode[],
		faultyNodes: string[],
		organizations: FbasAnalysisOrganization[],
		mergeBy: MergeBy | null
	): Result<AnalysisMergedResult, Error> {
		const combined = Result.combine([
			this.analysisFacade.analyzeTopTier(nodes, organizations, mergeBy),
			this.analysisFacade.analyzeBlockingSets(
				nodes,
				[],
				organizations,
				mergeBy
			),
			this.analysisFacade.analyzeBlockingSets(
				nodes,
				faultyNodes,
				organizations,
				mergeBy
			),
			this.analysisFacade.analyzeSplittingSets(nodes, organizations, mergeBy)
		]);
		if (combined.isErr()) return err(combined.error);

		this.logCacheMiss(combined.value[0].cache_hit);

		const [topTier, blockingSets, blockingSetsFiltered, splittingSets] =
			combined.value;

		return ok({
			blockingSets: blockingSets.result,
			blockingSetsCount: blockingSets.size,
			blockingSetsFiltered: blockingSetsFiltered.result,
			blockingSetsFilteredCount: blockingSetsFiltered.size,
			blockingSetsFilteredMinSize: blockingSetsFiltered.min,
			blockingSetsMinSize: blockingSets.min,
			splittingSets: splittingSets.result,
			splittingSetsCount: splittingSets.size,
			splittingSetsMinSize: splittingSets.min,
			topTier: topTier.top_tier,
			topTierSize: topTier.top_tier_size
		});
	}

	private logCacheMiss(cacheHit: boolean) {
		if (!cacheHit) {
			this.logger.info('fbas analysis cache not hit');
		}
	}
}
