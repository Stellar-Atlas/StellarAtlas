import { AnalysisMergedResult } from './AnalysisMergedResult.js';

export interface AnalysisResult {
	hasQuorumIntersection: boolean;
	hasSymmetricTopTier: boolean;
	node: AnalysisMergedResult;
	organization: AnalysisMergedResult;
	isp: AnalysisMergedResult;
	country: AnalysisMergedResult;
}
