import type {
	PublicApiStatus,
	PublicArchiveScanWorkers,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicFailoverStatus,
	PublicFullHistoryStatus,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';
import { StatCard } from '../stat-card';
import { ArchiveWorkerJobs } from './archive-worker-jobs';
import { FullHistoryStatusPanel } from './full-history-status-panel';
import { RecentScanLogs } from './recent-scan-logs';
import {
	ServiceStatusPanels,
	criticalServiceStatus
} from './service-status-panels';
import { StatusPill, StatusRow, statusLabel, statusTone } from './status-ui';

interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly archiveWorkers: PublicArchiveScanWorkers;
	readonly dataQuality: PublicDataQualityStatus;
	readonly failover: PublicFailoverStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly fullHistory: PublicFullHistoryStatus;
	readonly horizon: PublicConfiguredServiceStatus;
	readonly rpc: PublicConfiguredServiceStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	archiveWorkers,
	dataQuality,
	failover,
	frontend,
	fullHistory,
	horizon,
	rpc,
	scanLogs,
	workers
}: StatusDashboardProps): React.JSX.Element {
	const scan = dataQuality.scans.networkScan;
	const rollups = dataQuality.rollups.networkRollups;
	const archiveQueue = dataQuality.archiveQueue;
	const productionServiceStatus = criticalServiceStatus(api, frontend);

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
					detail={`${formatInteger(scan.completedScans)} of ${formatInteger(scan.totalScans)} recorded scans completed; cadence target ${formatNullablePercent(scan.expectedCompletionRate)}`}
					label="Network scans"
					tone={statusTone(scan.status)}
					value={formatNullablePercent(scan.completionRate)}
				/>
				<StatCard
					detail={`${formatInteger(rollups.missingRollupDays)} missing, ${formatInteger(rollups.mismatchedRollupDays)} mismatched`}
					label="Rollup continuity"
					tone={statusTone(rollups.status)}
					value={`${formatInteger(rollups.matchingDays)} matched`}
				/>
				<StatCard
					detail={`${formatInteger(archiveQueue.pendingJobs)} pending, ${formatInteger(archiveQueue.staleJobs)} stale`}
					label="Archive jobs"
					tone={statusTone(archiveQueue.status)}
					value={`${formatInteger(archiveQueue.activeJobs)} claimed`}
				/>
				<StatCard
					detail={`${formatInteger(workers.archiveWorkers.activeWorkers)} fresh, ${formatInteger(workers.archiveWorkers.staleWorkers)} stale`}
					label="Worker leases"
					tone={statusTone(workers.status)}
					value={`${formatInteger(workers.archiveWorkers.totalTakenJobs)} claimed`}
				/>
				<StatCard
					detail={`API ${statusLabel(api.status)}, frontend ${
						frontend.configured ? 'configured' : 'missing'
					}; Horizon/RPC are roadmap services unless configured as required`}
					label="Production services"
					tone={statusTone(productionServiceStatus)}
					value={statusLabel(productionServiceStatus)}
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
							detail={`Age ${formatDuration(dataQuality.dataFreshness.archiveScan.ageMs)}`}
							label="Archive scan"
							status={dataQuality.dataFreshness.archiveScan.status}
							value={formatNullableDate(
								dataQuality.dataFreshness.archiveScan.latestAt
							)}
						/>
						<StatusRow
							detail={`${formatInteger(scan.completedScans)} completed, ${formatInteger(scan.incompleteScans)} incomplete`}
							label="Recorded scan completion"
							status={scan.status}
							value={formatNullablePercent(scan.completionRate)}
						/>
						<StatusRow
							detail={`${formatInteger(rollups.rawCompletedScans)} completed raw scans, ${formatInteger(rollups.rollupCrawlCount)} rolled up`}
							label="Rollup continuity"
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
							detail={`${formatInteger(archiveQueue.pendingJobs)} pending, ${formatInteger(archiveQueue.staleJobs)} stale`}
							label="Archive queue"
							status={archiveQueue.status}
							value={`${formatInteger(archiveQueue.totalUnfinishedJobs)} jobs`}
						/>
						<StatusRow
							detail={`${formatInteger(workers.archiveWorkers.activeWorkers)} fresh, ${formatInteger(workers.archiveWorkers.staleWorkers)} stale; stale after ${formatDuration(workers.archiveWorkers.staleJobAgeMs)}`}
							label="Archive workers"
							status={workers.archiveWorkers.status}
							value={`${formatInteger(workers.archiveWorkers.totalTakenJobs)} claimed`}
						/>
						<StatusRow
							detail={`${formatInteger(workers.communityScanners.offlineScanners)} offline, ${formatInteger(workers.communityScanners.degradedScanners)} degraded`}
							label="Community scanners"
							status={workers.communityScanners.status}
							value={`${formatInteger(workers.communityScanners.activeScanners)} active`}
						/>
					</div>
				</section>

				<ServiceStatusPanels
					api={api}
					failover={failover}
					frontend={frontend}
					horizon={horizon}
					rpc={rpc}
				/>

				<FullHistoryStatusPanel fullHistory={fullHistory} />

				<ArchiveWorkerJobs archiveWorkers={archiveWorkers} />

				<RecentScanLogs scanLogs={scanLogs} />
			</div>
		</div>
	);
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatNullablePercent(value: number | null): string {
	return value === null ? 'No data' : formatPercent(value);
}

function formatDuration(value: number | null): string {
	if (value === null) return 'unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}
