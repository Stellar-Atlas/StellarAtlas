import type { PublicFullHistoryStatus, PublicStatusLevel } from '@api/types';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { formatCanonicalEvidenceSelection } from '../canonical-history-copy';
import { HistoricalBackfillStatusRow } from './historical-backfill-status-row';
import { LedgerCloseMetaStateStatusRows } from './ledger-close-meta-state-status-rows';
import {
	compatibilityIndexIssueCount,
	compatibilityIndexStatus
} from './status-dashboard-health';
import { StatusPill, StatusRow } from './status-ui';

export function CompatibilityIndexPanel({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const issues = compatibilityIndexIssueCount(fullHistory);
	const status = compatibilityIndexStatus(fullHistory);
	const awaitingFirstProof =
		issues === 0 &&
		fullHistory.status !== 'unavailable' &&
		fullHistory.canonicalPromotion?.state === 'waiting-for-proof';
	const summary =
		issues > 0
			? `${issues} component${issues === 1 ? '' : 's'} need${issues === 1 ? 's' : ''} attention`
			: awaitingFirstProof
				? 'Awaiting proof'
				: status === 'unavailable'
					? 'Telemetry unavailable'
					: status === 'degraded'
						? 'Limited coverage'
						: 'Recorded state';
	return (
		<section
			className="panel"
			aria-label="Compatibility indexes"
			style={{ gridColumn: '1 / -1' }}
		>
			<details>
				<summary className="panel-heading" style={{ cursor: 'pointer' }}>
					<strong>Compatibility diagnostics</strong>
					<StatusPill
						status={status}
						text={summary}
						tone={awaitingFirstProof || status === 'ok' ? 'neutral' : undefined}
					/>
					<span className="muted-inline">View details</span>
				</summary>
				<p className="muted-copy">
					Proof-linked indexes for older local-history APIs, not the parsed
					analytics dataset.
					{issues > 0
						? ' Recorded failures below remain unresolved.'
						: ' Historical coverage and queues are shown below.'}
					These records do not describe current archive scanner health. Review
					error codes and timestamps when investigating index repairs; queued
					records alone do not establish that a worker is running.
				</p>
				<div className="status-list">
					<CanonicalHistoryStatusRow fullHistory={fullHistory} />
					<LedgerCloseMetaStateStatusRows fullHistory={fullHistory} />
					<HistoricalBackfillStatusRow
						backfill={fullHistory.historicalBackfill}
					/>
				</div>
			</details>
		</section>
	);
}

function CanonicalHistoryStatusRow({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const formatDateTime = useLocalDateTimeFormatter();
	const coverage = fullHistory.canonicalCoverage;
	const promotion = fullHistory.canonicalPromotion;
	const active =
		promotion !== null &&
		['promoting', 'running', 'waiting-for-proof'].includes(promotion.state);
	const promotionStatus: PublicStatusLevel = active
		? 'ok'
		: promotion?.state === 'failed' || promotion?.state === 'stale'
			? 'degraded'
			: 'unavailable';
	const promotionLabel = describeCanonicalPromotion(
		fullHistory,
		formatDateTime
	);
	if (coverage === null) {
		const unavailable = fullHistory.status === 'unavailable';
		return (
			<StatusRow
				label="Proof-linked canonical index"
				status={unavailable ? 'unavailable' : promotionStatus}
				tone={!unavailable && active ? 'neutral' : undefined}
				pillText={
					unavailable ? 'Unavailable' : canonicalPromotionPill(fullHistory)
				}
				value={unavailable ? 'Telemetry unavailable' : 'Not indexed'}
				detail={
					unavailable
						? 'Canonical index telemetry is unavailable; indexed coverage has not been reported.'
						: `No proof-gated checkpoint has been promoted into the local index; ${promotionLabel}.`
				}
			/>
		);
	}
	const evidence = coverage.latestEvidence;
	const evidenceDetail =
		evidence === null
			? 'latest proof details loading'
			: `latest checkpoint ${formatInteger(Number(evidence.checkpointLedger))} selected by proof ${evidence.checkpointProofId} v${evidence.proofVersion} from ${evidence.archiveUrlIdentity}`;
	return (
		<StatusRow
			detail={`${formatInteger(coverage.ledgerCount)} proof-gated ledgers; ${formatInteger(coverage.transactionCount)} transactions with matching results; ${evidenceDetail}; ${formatCanonicalEvidenceSelection(coverage.archiveSourceCount)}; ${promotionLabel}. This index coverage is not source-lake or parsed analytics coverage.`}
			label="Proof-linked canonical index"
			pillText={canonicalPromotionPill(fullHistory)}
			status={promotionStatus}
			value={`${formatInteger(Number(coverage.firstLedger))} - ${formatInteger(Number(coverage.lastLedger))}`}
		/>
	);
}

function describeCanonicalPromotion(
	fullHistory: PublicFullHistoryStatus,
	formatDateTime: (value: string) => string
): string {
	const promotion = fullHistory.canonicalPromotion;
	if (promotion === null) return 'continuous promotion has not started';
	if (promotion.state === 'waiting-for-proof') {
		const checkpoint =
			promotion.checkpointLedger === null
				? 'the first verified checkpoint'
				: `verified checkpoint ${formatInteger(Number(promotion.checkpointLedger))}`;
		return `waiting for ${checkpoint}; heartbeat ${formatDateTime(promotion.heartbeatAt)}`;
	}
	if (promotion.state === 'promoting') {
		const checkpoint =
			promotion.checkpointLedger === null
				? 'next checkpoint'
				: `checkpoint ${formatInteger(Number(promotion.checkpointLedger))}`;
		return `promoting ${checkpoint}; heartbeat ${formatDateTime(promotion.heartbeatAt)}`;
	}
	if (promotion.state === 'running')
		return `continuous promotion active; heartbeat ${formatDateTime(promotion.heartbeatAt)}`;
	if (promotion.state === 'failed')
		return `continuous promotion stopped after ${promotion.lastErrorCode ?? 'an internal failure'}; repair the reported projection or importer error before retrying promotion`;
	return `continuous promotion ${promotion.state}; last heartbeat ${formatDateTime(promotion.heartbeatAt)}`;
}

function canonicalPromotionPill(fullHistory: PublicFullHistoryStatus): string {
	const state = fullHistory.canonicalPromotion?.state;
	if (state === 'waiting-for-proof') return 'Waiting for proof';
	if (state === 'promoting') return 'Promoting';
	if (state === 'running') return 'Active';
	if (state === 'failed') return 'Promotion failed';
	if (state === 'stale') return 'Heartbeat stale';
	if (state === 'stopped') return 'Stopped';
	return 'Not started';
}
