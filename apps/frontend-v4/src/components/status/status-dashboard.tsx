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
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatCard } from '../stat-card';
import {
	archiveHealthLabel,
	assessArchiveHealth,
	assessArchiveScannerHealth,
	checkpointProofIsComplete,
	type ArchiveHealthAssessment,
	type ArchiveHealthState
} from '@domain/history-archive-health';
import { StatusArchiveEvidenceTables } from './archive-status-tables';
import { RecentScanLogs } from './recent-scan-logs';
import {
	ArchiveHealthPill,
	ArchiveHealthRow,
	StatusPill,
	StatusRow,
	statusLabel,
	statusTone
} from './status-ui';

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
		archiveEvidenceAvailable ||
		workers.archiveWorkers.status !== 'unavailable' ||
		workers.archiveWorkers.configuredWorkerProcesses > 0;
	const observedActiveChecks = Math.max(
		archiveObjectActivity.freshActiveObjects,
		workers.archiveWorkers.activeWorkers
	);
	const archiveAssessment = assessArchiveHealth({
		evidenceAvailable: archiveEvidenceAvailable,
		observedActiveChecks,
		summary: archiveEvidenceAvailable ? archiveSummary : null
	});
	const archiveScannerHealth = assessArchiveScannerHealth({
		activeChecks: observedActiveChecks,
		configuredWorkers: workers.archiveWorkers.configuredWorkerProcesses,
		proofComplete:
			archiveEvidenceAvailable && checkpointProofIsComplete(archiveSummary),
		staleChecks: Math.max(
			archiveObjectActivity.staleActiveObjects,
			workers.archiveWorkers.staleWorkers
		),
		telemetryAvailable: archiveTelemetryAvailable,
		waitingChecks: archiveSummary.pendingObjects,
		workerStatus: workers.archiveWorkers.status
	});
	const archiveQueueDetail = archiveEvidenceAvailable
		? formatArchiveObjectQueueDetail(archiveSummary, archiveAssessment)
		: archiveTelemetryAvailable
			? 'Archive aggregate is loading; worker telemetry is live'
			: 'Archive file evidence endpoints did not respond';
	const archiveVerifierDetail = formatArchiveWorkerDetail(
		archiveObjectActivity,
		workers
	);
	const frontendApiStatus = criticalRuntimeStatus(
		api.status,
		frontend.configured
	);

	return (
		<div className="status-dashboard">
			<div className="stats-grid">
				<StatCard
					detail={archiveQueueDetail}
					label="Archive evidence"
					tone={archiveStatTone(archiveAssessment.state)}
					value={archiveHealthLabel(archiveAssessment.state)}
				/>
				<StatCard
					detail={archiveVerifierDetail}
					label="Archive scanner activity"
					tone={archiveStatTone(archiveScannerHealth)}
					value={formatScannerHeadline(
						archiveObjectActivity,
						archiveSummary,
						archiveScannerHealth,
						workers
					)}
				/>
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
						<ArchiveHealthRow
							detail={archiveQueueDetail}
							label="Archive evidence"
							state={archiveAssessment.state}
							value={formatArchiveEvidenceHeadline(archiveAssessment)}
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
							<strong>Archive scanner activity</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<ArchiveHealthPill state={archiveScannerHealth} />
					</div>
					<div className="status-list">
						<ArchiveHealthRow
							detail={archiveVerifierDetail}
							label="Current checks"
							state={archiveScannerHealth}
							value={formatScannerHeadline(
								archiveObjectActivity,
								archiveSummary,
								archiveScannerHealth,
								workers
							)}
						/>
					</div>
				</section>

				{archiveEvidenceAvailable ? (
					<StatusArchiveEvidenceTables
						events={archiveEvents}
						health={archiveAssessment}
						summary={archiveSummary}
					/>
				) : (
					<ArchiveEvidenceDeferredPanel
						archiveTelemetryAvailable={archiveTelemetryAvailable}
					/>
				)}

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
	summary: PublicHistoryArchiveObjectSummary
): ArchiveObjectSummary {
	if (!objectsAvailable) {
		return {
			freshActiveObjects: summary.activeObjects,
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

function formatArchiveObjectQueueDetail(
	summary: PublicHistoryArchiveObjectSummary,
	health: ArchiveHealthAssessment
): string {
	const sourceCount =
		summary.sources.length > 0
			? summary.sources.length
			: summary.checkpoints.archiveRootsWithState;
	const facts = health.facts;
	return [
		formatArchiveEvidenceHeadline(health),
		`${formatInteger(sourceCount)} archive sources`,
		`${formatInteger(facts.provenCheckpointProofs)} / ${formatInteger(facts.expectedCheckpointProofs)} checkpoint proofs verified`
	].join('; ');
}

function formatArchiveEvidenceHeadline(
	health: ArchiveHealthAssessment
): string {
	const facts = health.facts;
	if (health.state === 'remote_failure') {
		if (facts.checkpointMismatches > 0) {
			return `${formatInteger(facts.checkpointMismatches)} checkpoint mismatches`;
		}
		if (facts.failedEvidenceRows > 0) {
			return `${formatInteger(facts.failedEvidenceRows)} remote failures`;
		}
		if (facts.failingArchiveSources > 0) {
			return `${formatInteger(facts.failingArchiveSources)} failing archive sources`;
		}
		return `${formatInteger(facts.remoteHostFailures)} remote host failures`;
	}
	if (health.state === 'scanner_issue') {
		return `${formatInteger(facts.scannerIssues)} scanner issues`;
	}
	if (health.state === 'verified') {
		return `${formatInteger(facts.provenCheckpointProofs)} checkpoint proofs verified`;
	}
	if (health.state === 'checking') {
		return `${formatInteger(facts.activeChecks)} checks active`;
	}
	if (health.state === 'waiting') {
		return `${formatInteger(facts.waitingChecks)} proofs waiting`;
	}
	return 'Proof state unknown';
}

function formatScannerHeadline(
	activity: ArchiveObjectSummary,
	summary: PublicHistoryArchiveObjectSummary,
	state: ArchiveHealthState,
	workers: PublicWorkerStatus
): string {
	const objectWorkers = workers.archiveWorkers;
	const staleChecks = Math.max(
		objectWorkers.staleWorkers,
		activity.staleActiveObjects
	);
	if (state === 'scanner_issue' && staleChecks > 0) {
		return `${formatInteger(Math.max(objectWorkers.staleWorkers, activity.staleActiveObjects))} stale checks`;
	}
	if (state === 'scanner_issue') return 'Scanner issue';
	if (state === 'checking') {
		return `${formatInteger(Math.max(objectWorkers.activeWorkers, activity.freshActiveObjects))} checks active`;
	}
	if (state === 'waiting') {
		return `${formatInteger(summary.pendingObjects)} checks waiting`;
	}
	if (state === 'verified') return 'Scanner idle';
	return 'Scanner state unknown';
}

function archiveStatTone(
	state: ArchiveHealthState
): 'good' | 'warning' | 'danger' | undefined {
	if (state === 'verified') return 'good';
	if (state === 'remote_failure') return 'danger';
	if (state === 'scanner_issue') return 'warning';
	return undefined;
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
