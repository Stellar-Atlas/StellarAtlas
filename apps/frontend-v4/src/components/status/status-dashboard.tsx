'use client';

import type {
	PublicApiStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveStatusSummary,
	PublicConfiguredServiceStatus,
	PublicFullHistoryStatus,
	PublicDataQualityStatus,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { useLocalDateTimeFormatter } from '../local-date-time';
import { StatCard } from '../stat-card';
import {
	assessArchiveStatusHealth,
	assessArchiveScannerHealth,
	checkpointStatusProofIsComplete
} from '@domain/history-archive-health';
import { StatusArchiveEvidenceTables } from './archive-status-tables';
import { getArchiveDownloadActivity } from './archive-download-activity';
import { platformMonitoringStatus } from './status-dashboard-health';
import { CompatibilityIndexPanel } from './compatibility-index-panel';
import { formatArchiveWorkerCapacity } from './archive-worker-table-model';
import { ArchiveWorkerStatusTable } from './archive-worker-status-table';
import { resolveArchiveRuntimeActivity } from './archive-runtime-activity';
import { ArchiveRuntimeStatusPanel } from './archive-runtime-status-panel';
import { RecentScanLogs } from './recent-scan-logs';
import { LedgerCloseMetaStatusRow } from './ledger-close-meta-status-row';
import {
	buildStatusHeadlineCards,
	combineStatusLevels,
	describeArchiveRuntimeHeadline,
	describeArchiveSourceFinding
} from './status-dashboard-headlines';
import {
	ArchiveHealthPill,
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
	const formatDateTime = useLocalDateTimeFormatter();
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
		freshWorkers: workers.archiveWorkers.freshWorkers,
		missingWorkers: workers.archiveWorkers.missingWorkers,
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
	const archiveVerifierDetail = archiveTelemetryAvailable
		? formatArchiveWorkerDetail(archiveRuntimeActivity, workers)
		: 'Archive runtime telemetry is unavailable; current check counts are not reported.';
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
			detail:
				scan.status === 'unavailable'
					? 'Network scan counts unavailable; waiting for telemetry.'
					: `${formatInteger(scan.completedScans)} recent scans completed; latest data age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`,
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
						<StatusPill
							status={platformMonitoringStatus(
								api.status,
								networkMonitoringStatus
							)}
						/>
					</div>
					<div className="status-list">
						<StatusRow
							detail={`Frontend delivered this page; public API checked ${formatDateTime(api.generatedAt)}`}
							label="Public API"
							status={api.status}
							value={statusLabel(api.status)}
						/>
						<StatusRow
							detail={`Age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`}
							label="Network scan"
							status={dataQuality.dataFreshness.networkScan.status}
							value={formatNullableDate(
								dataQuality.dataFreshness.networkScan.latestAt,
								formatDateTime
							)}
						/>
						<StatusRow
							detail={
								scan.status === 'unavailable'
									? 'Network scan counts are unavailable.'
									: `${formatInteger(scan.completedScans)} completed, ${formatInteger(scan.incompleteScans)} incomplete`
							}
							label="Network scanner records"
							status={scan.status}
							value={
								scan.status === 'unavailable'
									? 'Unavailable'
									: `${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)}`
							}
						/>
					</div>
				</section>

				<ArchiveRuntimeStatusPanel
					checkedAt={formatDateTime(workers.generatedAt)}
					detail={archiveVerifierDetail}
					state={archiveScannerHealth}
					value={archiveRuntimeHeadline}
				/>

				<ArchiveWorkerStatusTable workers={workers} />

				<section
					className="panel"
					aria-label="Source lake and parsed analytics"
				>
					<div className="panel-heading">
						<div>
							<strong>Source lake and parsed analytics</strong>
							<span>
								Retained source data and queryable datasets have separate
								coverage
							</span>
						</div>
					</div>
					<div className="status-list">
						<LedgerCloseMetaStatusRow fullHistory={fullHistory} />
					</div>
					<p className="muted-copy">
						The lake retains ledger-close metadata and decoded files. Parsed
						analytics publishes queryable datasets separately; a retained ledger
						is not necessarily available to analytics yet. See{' '}
						<a href="/explorer">published analytics coverage in the explorer</a>
						.
					</p>
				</section>

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

				<CompatibilityIndexPanel fullHistory={fullHistory} />

				<RecentScanLogs available={scanLogsAvailable} scanLogs={scanLogs} />
			</div>
		</div>
	);
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
	const downloadActivity = getArchiveDownloadActivity(objectWorkers.workers);
	const staleText =
		activity.staleChecks > 0
			? `; ${formatInteger(activity.staleChecks)} stale check${activity.staleChecks === 1 ? '' : 's'} being reclaimed`
			: '';
	const activeText =
		activity.activeChecks > 0
			? `${formatInteger(activity.activeChecks)} active object check${activity.activeChecks === 1 ? '' : 's'}`
			: 'no active object checks at this instant';
	const downloadText =
		objectWorkers.telemetryMode === 'per-worker'
			? `; ${formatInteger(downloadActivity.activeDownloads)} network download${downloadActivity.activeDownloads === 1 ? '' : 's'} active; ${formatInteger(downloadActivity.waitingForDownloadSlots)} waiting for a download slot`
			: '';
	const capacity =
		objectWorkers.status === 'unavailable' &&
		objectWorkers.configuredWorkerProcesses === 0
			? 'Worker capacity unavailable'
			: formatArchiveWorkerCapacity(objectWorkers);
	return `${capacity}; ${activeText}${downloadText}${staleText}`;
}

function formatNullableDate(
	value: string | null,
	formatDateTime: (value: string) => string
): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatDuration(value: number | null): string {
	if (value === null) return 'unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}
