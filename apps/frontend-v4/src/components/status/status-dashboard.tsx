import type {
	PublicApiStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicStatusLevel,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';
import { StatCard } from '../stat-card';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { StatusArchiveEvidenceTables } from './archive-status-tables';
import { RecentScanLogs } from './recent-scan-logs';
import { StatusPill, StatusRow, statusLabel, statusTone } from './status-ui';

interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly archiveEvidenceAvailable: boolean;
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveObjectsAvailable: boolean;
	readonly archiveSummary: PublicHistoryArchiveObjectSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	archiveEvidenceAvailable,
	archiveEvents,
	archiveObjects,
	archiveObjectsAvailable,
	archiveSummary,
	dataQuality,
	frontend,
	scanLogs,
	workers
}: StatusDashboardProps): React.JSX.Element {
	const scan = dataQuality.scans.networkScan;
	const archiveObjectActivity = summarizeArchiveObjects(
		archiveObjects,
		archiveObjectsAvailable,
		archiveSummary
	);
	const archiveQueueDetail = archiveEvidenceAvailable
		? formatArchiveObjectQueueDetail(archiveSummary)
		: 'Archive file evidence endpoints did not respond';
	const archiveVerifierDetail = formatArchiveWorkerDetail(workers);
	const archiveCoverageText = formatArchiveVerificationCoverage(archiveSummary);
	const archiveAttentionText = formatArchiveAttentionText(archiveSummary);
	const frontendApiStatus = criticalRuntimeStatus(
		api.status,
		frontend.configured
	);
	const archiveStatus = archiveEvidenceAvailable
		? archiveObjectActivity.status
		: 'unavailable';
	const archiveWorkerStatus = getArchiveWorkerStatus(
		workers,
	archiveEvidenceAvailable,
	archiveSummary
);

	return (
		<div className="status-dashboard">
			<div className="stats-grid">
				<StatCard
					detail={`API checked ${formatDateTime(api.generatedAt)}`}
					label="Frontend / API"
					tone={statusTone(frontendApiStatus)}
					value={statusLabel(frontendApiStatus)}
				/>
				<StatCard
					detail={`${formatInteger(scan.completedScans)} recent scans completed; ${formatInteger(scan.incompleteScans)} incomplete`}
					label="Network scans"
					tone={statusTone(scan.status)}
					value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)} complete`}
				/>
				<StatCard
					detail={archiveQueueDetail}
					label="Archive file checks"
					tone={statusTone(archiveStatus)}
					value={
						archiveEvidenceAvailable ? archiveAttentionText : 'Unavailable'
					}
				/>
				<StatCard
					detail={archiveVerifierDetail}
					label="Archive scanner workers"
					tone={statusTone(archiveWorkerStatus)}
					value={formatWorkerHeadline(workers)}
				/>
			</div>

			<div className="status-panel-grid">
				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Overview</strong>
							<span>{statusLabel(dataQuality.dataFreshness.status)}</span>
						</div>
						<StatusPill status={dataQuality.dataFreshness.status} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={`Age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`}
							label="Network scan"
							status={dataQuality.dataFreshness.networkScan.status}
							value={formatNullableDate(
								dataQuality.dataFreshness.networkScan.latestAt
							)}
						/>
						<StatusRow
							detail={archiveQueueDetail}
							label="Archive file checks"
							status={archiveStatus}
							value={
								archiveEvidenceAvailable ? archiveAttentionText : 'No data'
							}
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
							<strong>Archive scanner workers</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<StatusPill status={archiveWorkerStatus} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={
								archiveEvidenceAvailable
									? archiveQueueDetail
									: 'Archive file evidence endpoints did not respond'
							}
							label="Archive file checks"
							status={archiveStatus}
							value={
								archiveEvidenceAvailable ? archiveAttentionText : 'No data'
							}
						/>
						<StatusRow
							detail={archiveVerifierDetail}
							label="Worker slots"
							status={archiveWorkerStatus}
							value={formatWorkerHeadline(workers)}
						/>
					</div>
				</section>

				{archiveEvidenceAvailable ? (
					<StatusArchiveEvidenceTables
						archiveObjects={archiveObjects}
						archiveObjectsAvailable={archiveObjectsAvailable}
						summary={archiveSummary}
					/>
				) : (
					<ArchiveEvidenceUnavailablePanel />
				)}

				{archiveEvidenceAvailable && !archiveObjectsAvailable ? (
					<ArchiveQueueUnavailablePanel />
				) : null}

				<HistoryArchiveObjectEventLog
					events={archiveEvents}
					title="Archive file activity"
				/>

				<RecentScanLogs scanLogs={scanLogs} />
			</div>
		</div>
	);
}

function ArchiveEvidenceUnavailablePanel(): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive file checks unavailable</h2>
					<span className="muted-inline">
						Archive file evidence endpoints did not respond before the status page
						timeout.
					</span>
				</div>
				<StatusPill status="unavailable" />
			</div>
			<p className="archive-good-state">
				No archive verification claim is shown because the status page could not
				load the archive file evidence snapshot.
			</p>
		</section>
	);
}

function ArchiveQueueUnavailablePanel(): React.JSX.Element {
	return (
		<section className="panel detail-panel archive-panel">
			<div className="panel-heading">
				<div>
					<h2>Archive file sample</h2>
					<span className="muted-inline">
						The aggregate archive summary loaded, but the queue sample did not
						respond before the status page timeout.
					</span>
				</div>
				<StatusPill status="degraded" text="Sample unavailable" />
			</div>
			<p className="archive-good-state">
				Aggregate counts above still come from the archive evidence summary.
				Individual check rows are hidden until the sample endpoint responds.
			</p>
		</section>
	);
}

const ARCHIVE_OBJECT_STALE_AGE_MS = 2 * 60 * 1000;

interface ArchiveObjectSummary {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
	readonly status: PublicStatusLevel;
}

function summarizeArchiveObjects(
	objects: PublicHistoryArchiveObjectQueue,
	objectsAvailable: boolean,
	summary: PublicHistoryArchiveObjectSummary
): ArchiveObjectSummary {
	if (!objectsAvailable) {
		return {
			freshActiveObjects: summary.activeObjects,
			staleActiveObjects: 0,
			status: summary.failedObjects > 0 ? 'degraded' : 'ok'
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
	const status: PublicStatusLevel =
		objects.failedObjects > 0 || staleActiveObjects > 0 ? 'degraded' : 'ok';
	return {
		freshActiveObjects,
		staleActiveObjects,
		status
	};
}

function formatArchiveVerificationCoverage(
	summary: PublicHistoryArchiveObjectSummary
): string {
	if (summary.totalObjects <= 0) return '0 / 0 verified';

	return (
		formatInteger(summary.verifiedObjects) +
		' / ' +
		formatInteger(summary.totalObjects) +
		' verified (' +
		formatPercent((summary.verifiedObjects / summary.totalObjects) * 100) +
		')'
	);
}

function formatArchiveObjectQueueDetail(
	summary: PublicHistoryArchiveObjectSummary
): string {
	return `${formatInteger(summary.verifiedObjects)} verified of ${formatInteger(summary.totalObjects)} tracked; ${formatInteger(summary.pendingObjects)} waiting`;
}

function formatArchiveAttentionText(
	summary: PublicHistoryArchiveObjectSummary
): string {
	if (summary.failedObjects > 0) {
		return `${formatInteger(summary.failedObjects)} evidence failures`;
	}
	if (summary.activeObjects > 0) {
		return `${formatInteger(summary.activeObjects)} checking now`;
	}
	return formatArchiveVerificationCoverage(summary);
}

function formatWorkerHeadline(workers: PublicWorkerStatus): string {
	const archiveWorkers = workers.archiveWorkers;
	if (archiveWorkers.activeWorkers > 0) {
		return `${formatInteger(archiveWorkers.activeWorkers)} active workers`;
	}
	if (archiveWorkers.totalTakenJobs > 0) {
		return `${formatInteger(archiveWorkers.totalTakenJobs)} claimed jobs`;
	}
	return 'No active workers';
}

function formatArchiveWorkerDetail(workers: PublicWorkerStatus): string {
	const archiveWorkers = workers.archiveWorkers;
	return `${formatInteger(archiveWorkers.totalTakenJobs)} claimed jobs, ${formatInteger(archiveWorkers.activeWorkers)} active workers, ${formatInteger(archiveWorkers.staleWorkers)} stale workers`;
}

function getArchiveWorkerStatus(
	workers: PublicWorkerStatus,
	archiveEvidenceAvailable: boolean,
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	if (!archiveEvidenceAvailable) return 'unavailable';
	if (workers.archiveWorkers.status !== 'ok') {
		return workers.archiveWorkers.status;
	}
	if (summary.pendingObjects > 0 && workers.archiveWorkers.activeWorkers === 0) {
		return 'degraded';
	}
	return 'ok';
}

function criticalRuntimeStatus(
	apiStatus: PublicStatusLevel,
	frontendConfigured: boolean
): PublicStatusLevel {
	if (!frontendConfigured || apiStatus === 'unavailable') return 'unavailable';
	if (apiStatus === 'degraded') return 'degraded';
	return 'ok';
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
