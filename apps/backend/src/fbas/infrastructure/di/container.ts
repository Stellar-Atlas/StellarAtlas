import { interfaces } from 'inversify';
import { GetFbasAnalysisProof } from '../../use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetFbasAnalysis } from '../../use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';
import { GetTopTierHistory } from '../../use-cases/get-top-tier-history/GetTopTierHistory.js';
import Container = interfaces.Container;

export function load(container: Container) {
	container.bind(GetFbasAnalysis).toSelf();
	container.bind(GetFbasAnalysisProof).toSelf();
	container.bind(GetLatestFbas).toSelf();
	container.bind(GetTopTierHistory).toSelf();
}
