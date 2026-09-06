import type { PublicFullHistoryStatus, PublicStatusLevel } from '@api/types';
import { combineStatusLevels } from './status-dashboard-headlines';

/** The section badge summarizes its displayed services, not just API connectivity. */
export function platformMonitoringStatus(
	api: PublicStatusLevel,
	network: PublicStatusLevel,
	history: PublicFullHistoryStatus
): PublicStatusLevel {
	const state = history.ledgerCloseMetaState;
	const linkage = state.canonicalLinkage;
	const lifecycle = linkage.lifecycle;
	const linkageInconsistent =
		lifecycle.total > 0 &&
		lifecycle.failed === 0 &&
		lifecycle.checking === 0 &&
		lifecycle.pending === 0 &&
		(lifecycle.complete !== lifecycle.total ||
			linkage.matchedLedgerCount !== linkage.expectedLedgerCount);
	const knownFailure =
		history.canonicalPromotion?.state === 'failed' ||
		history.canonicalPromotion?.state === 'stale' ||
		history.historicalBackfill?.state === 'failed' ||
		state.imports.lifecycle.failed > 0 ||
		lifecycle.failed > 0 ||
		linkageInconsistent;
	const promotionAvailable =
		history.canonicalPromotion !== null &&
		['promoting', 'running', 'waiting-for-proof'].includes(
			history.canonicalPromotion.state
		);
	const historyStatus: PublicStatusLevel = knownFailure
		? 'degraded'
		: history.canonicalCoverage === null || !promotionAvailable
			? 'unavailable'
			: history.status;
	return combineStatusLevels(combineStatusLevels(api, network), historyStatus);
}
