'use client';

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
import {
	checkpointProofIsComplete,
	getPendingBucketCheckCount
} from '@domain/history-archive-proof';
import { StatusArchiveEvidenceTables } from './archive-status-tables';
import { RecentScanLogs } from './recent-scan-logs';
import { StatusPill, StatusRow, statusLabel, statusTone } from './status-ui';

export interface StatusDashboardProps {
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
	const archiveTelemetryAvailable =
		archiveEvidenceAvailable || workers.archiveWorkers.configuredWorkerProcesses > 0;
	const archiveQueueDetail = archiveEvidenceAvailable
		? formatArchiveObjectQueueDetail(archiveSummary)
		: archiveTelemetryAvailable
			? 'Archive aggregate is loading; worker telemetry is live'
			: 'Archive file evidence endpoints did not respond';
	const archiveVerifierDetail = formatArchiveWorkerDetail(
		archiveObjectActivity,
		workers
	);
	const archiveAttentionText = formatArchiveAttentionText(
		archiveSummary,
		workers
	);
	const frontendApiStatus = criticalRuntimeStatus(
		api.status,
		frontend.configured
	);
	const archiveStatus = archiveEvidenceAvailable
		? getArchiveEvidenceStatus(archiveSummary)
		: archiveTelemetryAvailable
			? 'ok'
			: 'unavailable';
	const archiveWorkerStatus = getArchiveWorkerStatus(
		archiveObjectActivity,
		archiveTelemetryAvailable,
		archiveSummary,
		workers
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
					label="Archive evidence checks"
					tone={statusTone(archiveStatus)}
					value={
						archiveEvidenceAvailable || archiveTelemetryAvailable
							? archiveAttentionText
							: 'Unavailable'
					}
				/>
				<StatCard
					detail={archiveVerifierDetail}
					label="Archive scanner activity"
					tone={statusTone(archiveWorkerStatus)}
					value={formatWorkerHeadline(
						archiveObjectActivity,
						archiveSummary,
						workers
					)}
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
							label="Archive evidence checks"
							status={archiveStatus}
							value={
								archiveEvidenceAvailable || archiveTelemetryAvailable
									? archiveAttentionText
									: 'No data'
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
							<strong>Archive scanner activity</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<StatusPill status={archiveWorkerStatus} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={
								archiveQueueDetail
							}
							label="Archive evidence checks"
							status={archiveStatus}
							value={
								archiveEvidenceAvailable || archiveTelemetryAvailable
									? archiveAttentionText
									: 'No data'
							}
						/>
						<StatusRow
							detail={archiveVerifierDetail}
							label="Current checks"
							status={archiveWorkerStatus}
							value={formatWorkerHeadline(
								archiveObjectActivity,
								archiveSummary,
								workers
							)}
						/>
					</div>
				</section>

				{archiveEvidenceAvailable ? (
					<StatusArchiveEvidenceTables
						summary={archiveSummary}
					/>
				) : (
					<ArchiveEvidenceDeferredPanel
						archiveTelemetryAvailable={archiveTelemetryAvailable}
					/>
				)}

				<HistoryArchiveObjectEventLog
					events={archiveEvents}
					title="Archive file activity"
				/>

				<RecentScanLogs scanLogs={scanLogs} />
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
					<h2>Archive aggregate loading</h2>
					<span className="muted-inline">
						Worker telemetry is live; the aggregate evidence snapshot has not
						loaded yet.
					</span>
				</div>
				<StatusPill status={archiveTelemetryAvailable ? 'ok' : 'unavailable'} />
			</div>
			<p className="archive-good-state">
				The status stream is updating scanner activity while the archive
				coverage summary catches up.
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
			status: summary.totalObjects > 0 ? 'ok' : 'unavailable'
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
		summary.totalObjects > 0 ? 'ok' : 'unavailable';
	return {
		freshActiveObjects,
		staleActiveObjects,
		status
	};
}

function getArchiveEvidenceStatus(
	summary: PublicHistoryArchiveObjectSummary
): PublicStatusLevel {
	if (summary.totalObjects <= 0) return 'unavailable';
	if (checkpointProofIsComplete(summary)) return 'ok';
	return 'degraded';
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
	const sourceCount =
		summary.sources.length > 0
			? summary.sources.length
			: summary.checkpoints.archiveRootsWithState;
	const remoteFailureText =
		summary.failedObjects > 0
			? `; ${formatInteger(summary.failedObjects)} remote failures`
			: '';
	const activeText =
		summary.activeObjects > 0
			? `; ${formatInteger(summary.activeObjects)} checking now`
			: '';
	const proofText = checkpointProofIsComplete(summary)
		? `${formatInteger(summary.checkpoints.categoryConsistentArchiveCheckpoints)} proven checkpoint file sets`
		: formatArchiveProofWaitingDetail(summary);
	return `${formatInteger(sourceCount)} archive sources; ${proofText}${activeText}${remoteFailureText}`;
}

function formatArchiveAttentionText(
	summary: PublicHistoryArchiveObjectSummary,
	workers: PublicWorkerStatus
): string {
	const activeChecks = Math.max(
		summary.activeObjects,
		workers.archiveWorkers.activeWorkers
	);
	if (activeChecks > 0) {
		return `${formatInteger(activeChecks)} active checks`;
	}
	if (!checkpointProofIsComplete(summary)) {
		return 'Proof pending';
	}
	return formatArchiveVerificationCoverage(summary);
}

function formatWorkerHeadline(
	activity: ArchiveObjectSummary,
	summary: PublicHistoryArchiveObjectSummary,
	workers: PublicWorkerStatus
): string {
	const objectWorkers = workers.archiveWorkers;
	if (objectWorkers.staleWorkers > 0 || activity.staleActiveObjects > 0) {
		return `${formatInteger(Math.max(objectWorkers.staleWorkers, activity.staleActiveObjects))} stale checks`;
	}
	if (objectWorkers.configuredWorkerProcesses > 0) {
		return `${formatInteger(objectWorkers.configuredWorkerProcesses)} configured workers`;
	}
	if (summary.pendingObjects > 0) return 'Waiting for scanner';
	return 'Scanner idle';
}

function formatArchiveWorkerDetail(
	activity: ArchiveObjectSummary,
	workers: PublicWorkerStatus
): string {
	const objectWorkers = workers.archiveWorkers;
	const staleChecks = Math.max(
		objectWorkers.staleWorkers,
		activity.staleActiveObjects
	);
	const staleText =
		staleChecks > 0
			? `; ${formatInteger(staleChecks)} stale check${staleChecks === 1 ? '' : 's'} being reclaimed`
			: '';
	const activeText =
		objectWorkers.activeWorkers > 0
			? `${formatInteger(objectWorkers.activeWorkers)} active object check${objectWorkers.activeWorkers === 1 ? '' : 's'}`
			: 'no active object checks at this instant';
	return `${formatInteger(objectWorkers.configuredWorkerProcesses)} configured worker processes; ${activeText}${staleText}`;
}

function getArchiveWorkerStatus(
	activity: ArchiveObjectSummary,
	archiveEvidenceAvailable: boolean,
	summary: PublicHistoryArchiveObjectSummary,
	workers: PublicWorkerStatus
): PublicStatusLevel {
	if (!archiveEvidenceAvailable) return 'unavailable';
	if (workers.archiveWorkers.activeWorkers > 0) return 'ok';
	if (workers.archiveWorkers.status === 'degraded') return 'degraded';
	if (activity.staleActiveObjects > 0) return 'degraded';
	if (
		summary.pendingObjects > 0 &&
		workers.archiveWorkers.configuredWorkerProcesses === 0
	) {
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

function formatArchiveProofWaitingDetail(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const checkpoints = summary.checkpoints;
	if (checkpoints.categoryConsistencyFailedCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistencyFailedCheckpoints)} checkpoint mismatches`;
	}
	if (checkpoints.categoryConsistencyPendingCheckpoints > 0) {
		return `${formatInteger(checkpoints.categoryConsistencyPendingCheckpoints)} checkpoint file sets waiting`;
	}
	if (checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0) {
		const pendingBuckets = getPendingBucketCheckCount(summary);
		return pendingBuckets > 0
			? `${formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints)} file sets waiting for ${formatInteger(pendingBuckets)} bucket checks`
			: `${formatInteger(checkpoints.categoryConsistencyNotEvaluatedCheckpoints)} file sets collecting proof facts`;
	}
	return 'checkpoint proof not started';
}
