import { AnalysisMergedResult } from './AnalysisMergedResult.js';
import type {
	FbasMinimalQuorumsProof,
	FbasSymmetricTopTierProof
} from './FbasProofPayload.js';

export interface AnalysisResult {
	hasQuorumIntersection: boolean;
	hasSymmetricTopTier: boolean;
	minimalQuorums: FbasMinimalQuorumsProof;
	node: AnalysisMergedResult;
	organization: AnalysisMergedResult;
	isp: AnalysisMergedResult;
	country: AnalysisMergedResult;
	symmetricTopTier: FbasSymmetricTopTierProof | null;
}
