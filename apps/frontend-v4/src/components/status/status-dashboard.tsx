import type {
	PublicApiStatus,
	PublicHistoryArchiveBucketCrossCoverage,
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
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { HistoryArchiveObjectCoverage } from '@components/archive-scans/history-archive-object-coverage';
import { HistoryArchiveObjectInventory } from '@components/archive-scans/history-archive-object-inventory';
import { RecentScanLogs } from './recent-scan-logs';
import { ProductionServiceStatusPanel } from './service-status-panels';
import { StatusPill, StatusRow, statusLabel, statusTone } from './status-ui';

interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly archiveBucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveSummary: PublicHistoryArchiveObjectSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	archiveBucketCoverages,
	archiveEvents,
	archiveObjects,
	archiveSummary,
	dataQuality,
	frontend,
	scanLogs,
	workers
}: StatusDashboardProps): React.JSX.Element {
	const scan = dataQuality.scans.networkScan;
	const rollups = dataQuality.rollups.networkRollups;
	const archiveObjectActivity = summarizeArchiveObjects(archiveObjects);
	const archiveVerifierDetail = `${formatInteger(archiveObjectActivity.freshActiveObjects)} active file checks, ${formatInteger(archiveObjectActivity.staleActiveObjects)} delayed; ${formatInteger(archiveSummary.pendingObjects)} queued`;
	const showCommunityScanners =
		workers.communityScanners.activeScanners > 0 ||
		workers.communityScanners.offlineScanners > 0 ||
		workers.communityScanners.degradedScanners > 0;

	return (
		<div className="status-dashboard">
			<div className="stats-grid">
				<StatCard
					detail={`Generated ${formatDateTime(dataQuality.generatedAt)}`}
					label="Data quality"
					tone={statusTone(dataQuality.status)}
					value={statusLabel(dataQuality.status)}
				/>
				<StatCard
					detail={`${formatInteger(scan.incompleteScans)} incomplete recorded rows`}
					label="Network scanner"
					tone={statusTone(scan.status)}
					value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)} complete`}
				/>
				<StatCard
					detail={`${formatInteger(rollups.missingRollupDays)} missing, ${formatInteger(rollups.mismatchedRollupDays)} mismatched`}
					label="Daily network snapshots"
					tone={statusTone(rollups.status)}
					value={`${formatInteger(rollups.matchingDays)} current`}
				/>
				<StatCard
					detail={`${formatInteger(archiveSummary.pendingObjects)} pending, ${formatInteger(archiveSummary.failedObjects)} evidence failures`}
					label="Archive files"
					tone={statusTone(archiveObjectActivity.status)}
					value={`${formatInteger(archiveSummary.totalObjects)} stored`}
				/>
				<StatCard
					detail={`${formatInteger(archiveObjectActivity.freshActiveObjects)} fresh, ${formatInteger(archiveObjectActivity.staleActiveObjects)} delayed`}
					label="Archive file workers"
					tone={statusTone(archiveObjectActivity.workerStatus)}
					value={`${formatInteger(archiveSummary.activeObjects)} active`}
				/>
				<StatCard
					detail={`API ${statusLabel(api.status)}, frontend ${
						frontend.configured ? 'online' : 'missing'
					}`}
					label="Production services"
					tone={statusTone(api.status)}
					value={statusLabel(api.status)}
				/>
			</div>

			<div className="status-panel-grid">
				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Data Freshness</strong>
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
							detail={archiveVerifierDetail}
							label="Archive verifier"
							status={archiveObjectActivity.workerStatus}
							value={`${formatInteger(archiveSummary.activeObjects)} active`}
						/>
						<StatusRow
							detail={`${formatInteger(scan.completedScans)} completed, ${formatInteger(scan.incompleteScans)} incomplete`}
							label="Network scanner records"
							status={scan.status}
							value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)}`}
						/>
						<StatusRow
							detail={`${formatInteger(rollups.rawCompletedScans)} completed scans summarized into ${formatInteger(rollups.rollupCrawlCount)} daily snapshots`}
							label="Daily network snapshots"
							status={rollups.status}
							value={`${formatInteger(rollups.matchingDays)} days`}
						/>
					</div>
				</section>

				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Operations</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<StatusPill status={workers.status} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={`${formatInteger(archiveSummary.pendingObjects)} queued, ${formatInteger(archiveSummary.failedObjects)} evidence failures, ${formatInteger(archiveSummary.verifiedObjects)} verified`}
							label="Archive file queue"
							status={archiveObjectActivity.status}
							value={`${formatInteger(archiveObjectActivity.totalOpenObjects)} open files`}
						/>
						<StatusRow
							detail={`${formatInteger(archiveObjectActivity.freshActiveObjects)} fresh, ${formatInteger(archiveObjectActivity.staleActiveObjects)} delayed; delayed after ${formatDuration(ARCHIVE_OBJECT_STALE_AGE_MS)}`}
							label="Archive file workers"
							status={archiveObjectActivity.workerStatus}
							value={`${formatInteger(archiveSummary.activeObjects)} active`}
						/>
						{showCommunityScanners ? (
							<StatusRow
								detail={`${formatInteger(workers.communityScanners.offlineScanners)} offline, ${formatInteger(workers.communityScanners.degradedScanners)} degraded`}
								label="External scanner clients"
								status={workers.communityScanners.status}
								value={`${formatInteger(workers.communityScanners.activeScanners)} active`}
							/>
						) : null}
					</div>
				</section>

				<ProductionServiceStatusPanel
					api={api}
					dataQuality={dataQuality}
					archiveObjects={archiveObjects}
					archiveSummary={archiveSummary}
					frontend={frontend}
				/>

				<HistoryArchiveObjectCoverage
					summary={archiveSummary}
					title="Archive file coverage"
				/>

				<HistoryArchiveObjectInventory
					bucketCoverages={archiveBucketCoverages}
					objects={archiveObjects}
					title="Current archive file work"
				/>

				<HistoryArchiveObjectEventLog
					events={archiveEvents}
					title="Recent archive file activity"
				/>

				<RecentScanLogs scanLogs={scanLogs} />
			</div>
		</div>
	);
}

const ARCHIVE_OBJECT_STALE_AGE_MS = 2 * 60 * 1000;

interface ArchiveObjectSummary {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
	readonly status: PublicStatusLevel;
	readonly totalOpenObjects: number;
	readonly workerStatus: PublicStatusLevel;
}

function summarizeArchiveObjects(
	objects: PublicHistoryArchiveObjectQueue
): ArchiveObjectSummary {
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
	const status: PublicStatusLevel = staleActiveObjects > 0 ? 'degraded' : 'ok';
	const workerStatus: PublicStatusLevel =
		staleActiveObjects > 0 ? 'degraded' : 'ok';

	return {
		freshActiveObjects,
		staleActiveObjects,
		status,
		totalOpenObjects: objects.activeObjects + objects.pendingObjects,
		workerStatus
	};
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
