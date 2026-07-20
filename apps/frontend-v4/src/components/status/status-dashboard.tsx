'use client';

import type {
	PublicApiStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveStatusSummary,
	PublicConfiguredServiceStatus,
	PublicFullHistoryStatus,
	PublicDataQualityStatus,
	PublicStatusLevel,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { formatCanonicalEvidenceSelection } from '../canonical-history-copy';
import { StatCard } from '../stat-card';
import {
	assessArchiveStatusHealth,
	assessArchiveScannerHealth,
	checkpointStatusProofIsComplete
} from '@domain/history-archive-health';
import { StatusArchiveEvidenceTables } from './archive-status-tables';
import { ArchiveWorkerStatusTable } from './archive-worker-status-table';
import { resolveArchiveRuntimeActivity } from './archive-runtime-activity';
import { RecentScanLogs } from './recent-scan-logs';
import { LedgerCloseMetaStatusRow } from './ledger-close-meta-status-row';
import { LedgerCloseMetaStateStatusRows } from './ledger-close-meta-state-status-rows';
import { HistoricalBackfillStatusRow } from './historical-backfill-status-row';
import {
	buildStatusHeadlineCards,
	combineStatusLevels,
	describeArchiveRuntimeHeadline,
	describeArchiveSourceFinding
} from './status-dashboard-headlines';
import {
	ArchiveHealthPill,
	ArchiveHealthRow,
	StatusPill,
	StatusRow,
	statusLabel
} from './status-ui';

export interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly archiveEvidenceAvailable: boolean;
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveEventsAvailable: boolean;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveObjectsAvailable: boolean;
	readonly archiveSummary: PublicHistoryArchiveStatusSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly fullHistory: PublicFullHistoryStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly scanLogsAvailable: boolean;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	archiveEvidenceAvailable,
	archiveEvents,
	archiveEventsAvailable,
	archiveObjects,
	archiveObjectsAvailable,
	archiveSummary,
	dataQuality,
	fullHistory,
	scanLogs,
	scanLogsAvailable,
	workers
}: StatusDashboardProps): React.JSX.Element {
	const scan = dataQuality.scans.networkScan;
	const archiveObjectActivity = summarizeArchiveObjects(
		archiveObjects,
		archiveObjectsAvailable,
		archiveSummary
	);
	const archiveTelemetryAvailable =
		archiveEvidenceAvailable ||
		workers.archiveWorkers.status !== 'unavailable' ||
		workers.archiveWorkers.configuredWorkerProcesses > 0;
	const archiveRuntimeActivity = resolveArchiveRuntimeActivity(
		archiveObjectActivity,
		workers.archiveWorkers
	);
	const observedActiveChecks = archiveRuntimeActivity.activeChecks;
	const archiveAssessment = assessArchiveStatusHealth({
		evidenceAvailable: archiveEvidenceAvailable,
		observedActiveChecks,
		summary: archiveEvidenceAvailable ? archiveSummary : null
	});
	const archiveScannerHealth = assessArchiveScannerHealth({
		activeChecks: observedActiveChecks,
		configuredWorkers: workers.archiveWorkers.configuredWorkerProcesses,
		proofComplete:
			archiveEvidenceAvailable &&
			checkpointStatusProofIsComplete(archiveSummary),
		staleChecks: archiveRuntimeActivity.staleChecks,
		telemetryAvailable: archiveTelemetryAvailable,
		waitingChecks: archiveAssessment.facts.waitingChecks,
		workerStatus: workers.archiveWorkers.status
	});
	const archiveRuntimeHeadline = describeArchiveRuntimeHeadline({
		activeChecks: observedActiveChecks,
		staleChecks: archiveRuntimeActivity.staleChecks,
		state: archiveScannerHealth
	});
	const archiveVerifierDetail = formatArchiveWorkerDetail(
		archiveRuntimeActivity,
		workers
	);
	const networkMonitoringStatus = combineStatusLevels(
		scan.status,
		dataQuality.dataFreshness.networkScan.status
	);
	const archiveSourceCount = Math.max(
		archiveSummary.sourceCount,
		archiveSummary.checkpointCoverage.archiveRootsWithState
	);
	const archiveFinding = describeArchiveSourceFinding(
		archiveAssessment,
		archiveSourceCount
	);
	const headlineCards = buildStatusHeadlineCards({
		archiveFinding,
		archiveRuntime: {
			detail: archiveVerifierDetail,
			state: archiveScannerHealth,
			value: archiveRuntimeHeadline
		},
		network: {
			detail: `${formatInteger(scan.completedScans)} recent scans completed; latest data age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`,
			status: networkMonitoringStatus
		},
		platform: {
			detail: `Public API checked ${formatDateTime(api.generatedAt)}; frontend delivered this page`,
			status: api.status
		}
	});

	return (
		<div className="status-dashboard">
			<div className="stats-grid">
				{headlineCards.map((card) => (
					<StatCard
						detail={card.detail}
						key={card.key}
						label={card.label}
						tone={card.tone}
						value={card.value}
					/>
				))}
			</div>

			<div className="status-panel-grid">
				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Platform and monitoring</strong>
							<span>StellarAtlas runtime and network data freshness</span>
						</div>
						<StatusPill status={api.status} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={`Frontend delivered this page; public API checked ${formatDateTime(api.generatedAt)}`}
							label="Public API"
							status={api.status}
							value={statusLabel(api.status)}
						/>
						<CanonicalHistoryStatusRow fullHistory={fullHistory} />
						<LedgerCloseMetaStatusRow fullHistory={fullHistory} />
						<LedgerCloseMetaStateStatusRows fullHistory={fullHistory} />
						<HistoricalBackfillStatusRow
							backfill={fullHistory.historicalBackfill}
						/>
						<StatusRow
							detail={`Age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`}
							label="Network scan"
							status={dataQuality.dataFreshness.networkScan.status}
							value={formatNullableDate(
								dataQuality.dataFreshness.networkScan.latestAt
							)}
						/>
						<StatusRow
							detail={`${formatInteger(scan.completedScans)} completed, ${formatInteger(scan.incompleteScans)} incomplete`}
							label="Network scanner records"
							status={scan.status}
							value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)}`}
						/>
					</div>
				</section>

				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Archive verification runtime</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<ArchiveHealthPill state={archiveScannerHealth} />
					</div>
					<div className="status-list">
						<ArchiveHealthRow
							detail={archiveVerifierDetail}
							label="Current checks"
							state={archiveScannerHealth}
							value={archiveRuntimeHeadline}
						/>
					</div>
				</section>

				<ArchiveWorkerStatusTable workers={workers} />

				{archiveEvidenceAvailable ? (
					<StatusArchiveEvidenceTables
						events={archiveEvents}
						eventsAvailable={archiveEventsAvailable}
						finding={archiveFinding}
						health={archiveAssessment}
						summary={archiveSummary}
					/>
				) : (
					<ArchiveEvidenceDeferredPanel
						archiveTelemetryAvailable={archiveTelemetryAvailable}
					/>
				)}

				<RecentScanLogs available={scanLogsAvailable} scanLogs={scanLogs} />
			</div>
		</div>
	);
}

function CanonicalHistoryStatusRow({
	fullHistory
}: {
	readonly fullHistory: PublicFullHistoryStatus;
}): React.JSX.Element {
	const coverage = fullHistory.canonicalCoverage;
	if (coverage === null) {
		return (
			<StatusRow
				detail="No proof-gated checkpoint has been promoted into the local index."
				label="Canonical history"
				status="unavailable"
				value="Not indexed"
			/>
		);
	}
	const promotion = fullHistory.canonicalPromotion;
	const promotionStatus: PublicStatusLevel =
		promotion !== null &&
		['promoting', 'running', 'waiting-for-proof'].includes(promotion.state)
			? 'ok'
			: 'unavailable';
	const promotionLabel = describeCanonicalPromotion(fullHistory);
	const evidence = coverage.latestEvidence;
	const evidenceDetail =
		evidence === null
			? 'latest proof details loading'
			: `latest checkpoint ${formatInteger(Number(evidence.checkpointLedger))} selected by proof ${evidence.checkpointProofId} v${evidence.proofVersion} from ${evidence.archiveUrlIdentity}`;
	return (
		<StatusRow
			detail={`${formatInteger(coverage.ledgerCount)} proof-gated ledgers; ${formatInteger(coverage.transactionCount)} transactions with matching results; ${evidenceDetail}; ${formatCanonicalEvidenceSelection(coverage.archiveSourceCount)}; ${promotionLabel}`}
			label="Canonical history"
			pillText={canonicalPromotionPill(fullHistory)}
			status={promotionStatus}
			value={`${formatInteger(Number(coverage.firstLedger))} - ${formatInteger(Number(coverage.lastLedger))}`}
		/>
	);
}

function describeCanonicalPromotion(
	fullHistory: PublicFullHistoryStatus
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
	if (promotion.state === 'running') {
		return `continuous promotion active; heartbeat ${formatDateTime(promotion.heartbeatAt)}`;
	}
	if (promotion.state === 'failed') {
		return `continuous promotion stopped after ${promotion.lastErrorCode ?? 'an internal failure'}`;
	}
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

function ArchiveEvidenceDeferredPanel({
	archiveTelemetryAvailable
}: {
	readonly archiveTelemetryAvailable: boolean;
}): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive source evidence loading</h2>
					<span className="muted-inline">
						External archive findings are unavailable; platform runtime is
						reported above.
					</span>
				</div>
				<ArchiveHealthPill state="unknown" />
			</div>
			<p className="muted-copy">
				{archiveTelemetryAvailable
					? 'Scanner activity is available, but checkpoint proof is not loaded.'
					: 'Checkpoint proof and scanner activity are unavailable.'}
			</p>
		</section>
	);
}

const ARCHIVE_OBJECT_STALE_AGE_MS = 2 * 60 * 1000;

interface ArchiveObjectSummary {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
}

function summarizeArchiveObjects(
	objects: PublicHistoryArchiveObjectQueue,
	objectsAvailable: boolean,
	summary: PublicHistoryArchiveStatusSummary
): ArchiveObjectSummary {
	if (!objectsAvailable) {
		return {
			freshActiveObjects: summary.activeObjectChecks,
			staleActiveObjects: 0
		};
	}

	const generatedAtMs = Date.parse(objects.generatedAt);
	const staleActiveObjects = objects.objects.filter((object) => {
		if (object.status !== 'scanning') return false;
		const updatedAtMs = Date.parse(object.updatedAt);
		return (
			Number.isFinite(generatedAtMs) &&
			Number.isFinite(updatedAtMs) &&
			generatedAtMs - updatedAtMs > ARCHIVE_OBJECT_STALE_AGE_MS
		);
	}).length;
	const freshActiveObjects = Math.max(
		0,
		objects.activeObjects - staleActiveObjects
	);
	return {
		freshActiveObjects,
		staleActiveObjects
	};
}

function formatArchiveWorkerDetail(
	activity: { readonly activeChecks: number; readonly staleChecks: number },
	workers: PublicWorkerStatus
): string {
	const objectWorkers = workers.archiveWorkers;
	const staleText =
		activity.staleChecks > 0
			? `; ${formatInteger(activity.staleChecks)} stale check${activity.staleChecks === 1 ? '' : 's'} being reclaimed`
			: '';
	const activeText =
		activity.activeChecks > 0
			? `${formatInteger(activity.activeChecks)} active object check${activity.activeChecks === 1 ? '' : 's'}`
			: 'no active object checks at this instant';
	return `${formatInteger(objectWorkers.configuredWorkerProcesses)} configured worker processes; ${activeText}${staleText}`;
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatDuration(value: number | null): string {
	if (value === null) return 'unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}
