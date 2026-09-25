import type { PublicFullHistoryStatus, PublicStatusLevel } from '@api/types';
import { combineStatusLevels } from './status-dashboard-headlines';

/** Platform connectivity must not inherit compatibility-index failures. */
export function platformMonitoringStatus(
	api: PublicStatusLevel,
	network: PublicStatusLevel
): PublicStatusLevel {
	return combineStatusLevels(api, network);
}

/** Failures stay visible on the separate compatibility-index section. */
export function compatibilityIndexStatus(
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
	return knownFailure
		? 'degraded'
		: history.canonicalCoverage === null || !promotionAvailable
			? 'unavailable'
			: history.status;
}
