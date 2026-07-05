import type {
	PublicApiStatus,
	PublicArchiveScanWorkers,
	PublicArchiveScanLogEntry,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicFailoverStatus,
	PublicFullHistoryStatus,
	PublicNetworkScanLogEntry,
	PublicScanLogStatus,
	PublicStatusLevel,
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
	const services = [frontend, horizon, rpc];
	const serviceStatus = serviceGroupStatus(services, failover);
	const configuredServiceCount = getConfiguredServiceCount(services);
	const missingOwnedServiceCount = services.filter(
		(service) => !service.configured
	).length;

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
					detail={`${formatInteger(missingOwnedServiceCount)} missing owned targets; failover is optional`}
					label="Owned service targets"
					tone={statusTone(serviceStatus)}
					value={`${formatInteger(configuredServiceCount)} configured`}
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
						<StatusRow
							detail={formatDateTime(api.generatedAt)}
							label="API origin"
							status={api.status}
							value={statusLabel(api.status)}
						/>
					</div>
				</section>

				<section className="panel status-services-panel">
					<div className="panel-heading">
						<div>
							<strong>Owned Service Targets</strong>
							<span>Local deployment configuration</span>
						</div>
						<StatusPill status={serviceStatus} />
					</div>
					<div className="status-list">
						<ServiceRow service={frontend} />
						<ServiceRow service={horizon} />
						<ServiceRow service={rpc} />
						<FailoverRow failover={failover} />
					</div>
				</section>

				<FullHistoryStatusPanel fullHistory={fullHistory} />

				<ArchiveWorkerJobs archiveWorkers={archiveWorkers} />

				<section className="panel status-scan-log-panel">
					<div className="panel-heading">
						<div>
							<strong>Recent Scan Logs</strong>
							<span>{formatDateTime(scanLogs.generatedAt)}</span>
						</div>
						<span className="status-muted">
							{formatInteger(scanLogs.limit)} row limit
						</span>
					</div>
					<div className="status-scan-log-grid">
						<RecentNetworkScans scans={scanLogs.networkScans} />
						<RecentArchiveScans scans={scanLogs.archiveScans} />
					</div>
				</section>
			</div>
		</div>
	);
}

function RecentNetworkScans({
	scans
}: {
	readonly scans: readonly PublicNetworkScanLogEntry[];
}): React.JSX.Element {
	return (
		<div className="status-scan-log-column">
			<h3>Network scans</h3>
			<div className="status-list">
				{scans.map((scan) => (
					<StatusRow
						detail={`${formatInteger(scan.ledgersCount)} processed ledgers, close ${formatNullableDate(scan.latestLedgerCloseTime)}`}
						key={scan.time}
						label={formatDateTime(scan.time)}
						status={scan.completed ? 'ok' : 'degraded'}
						value={`Ledger ${scan.latestLedger}`}
					/>
				))}
				{scans.length === 0 && <EmptyLogRow label="No network scans" />}
			</div>
		</div>
	);
}

function RecentArchiveScans({
	scans
}: {
	readonly scans: readonly PublicArchiveScanLogEntry[];
}): React.JSX.Element {
	return (
		<div className="status-scan-log-column">
			<h3>Archive scan runs</h3>
			<div className="status-list">
				{scans.map((scan) => (
					<StatusRow
						detail={archiveScanDetail(scan)}
						key={`${scan.url}-${scan.startDate}-${scan.latestScannedLedger}`}
						label={formatArchiveUrl(scan.url)}
						status={archiveScanTone(scan)}
						value={archiveScanLabel(scan)}
					/>
				))}
				{scans.length === 0 && <EmptyLogRow label="No archive scans" />}
			</div>
		</div>
	);
}

function EmptyLogRow({ label }: { readonly label: string }): React.JSX.Element {
	return (
		<StatusRow
			detail="No recent rows returned"
			label={label}
			status="unavailable"
			value="No data"
		/>
	);
}

function StatusRow({
	detail,
	label,
	pillText,
	status,
	value
}: {
	readonly detail: string;
	readonly label: string;
	readonly pillText?: string;
	readonly status: PublicStatusLevel;
	readonly value: string;
}): React.JSX.Element {
	return (
		<div className="status-row">
			<div>
				<strong>{label}</strong>
				<small>{detail}</small>
			</div>
			<div className="status-row-value">
				<span>{value}</span>
				<StatusPill status={status} text={pillText} />
			</div>
		</div>
	);
}

function ServiceRow({
	service
}: {
	readonly service: PublicConfiguredServiceStatus;
}): React.JSX.Element {
	const usesExternalFallback = !service.configured && service.url !== null;

	return (
		<StatusRow
			detail={formatServiceDetail(service, usesExternalFallback)}
			label={serviceLabel(service.service)}
			status={service.status}
			value={service.configured ? 'Configured' : 'Missing'}
		/>
	);
}

function FailoverRow({
	failover
}: {
	readonly failover: PublicFailoverStatus;
}): React.JSX.Element {
	const detail = failover.complete
		? `${failover.frontendUrl} + ${failover.apiUrl}`
		: failover.configured
			? (failover.frontendUrl ?? failover.apiUrl ?? 'Partial target')
			: 'No optional failover target configured';
	const status = failover.configured ? failover.status : 'ok';

	return (
		<StatusRow
			detail={detail}
			label="Failover"
			pillText={!failover.configured ? 'Optional' : undefined}
			status={status}
			value={
				failover.complete
					? 'Complete'
					: failover.configured
						? 'Partial'
						: 'Optional'
			}
		/>
	);
}

function StatusPill({
	status,
	text
}: {
	readonly status: PublicStatusLevel;
	readonly text?: string;
}): React.JSX.Element {
	return (
		<span className={`status-pill ${statusTone(status)}`}>
			{text ?? statusLabel(status)}
		</span>
	);
}

function serviceGroupStatus(
	services: readonly PublicConfiguredServiceStatus[],
	failover: PublicFailoverStatus
): PublicStatusLevel {
	const statuses = [
		...services.map((service) => service.status),
		...(failover.configured ? [failover.status] : [])
	];
	if (statuses.length === 0) return 'ok';
	if (statuses.every((status) => status === 'ok')) return 'ok';
	if (statuses.every((status) => status === 'unavailable')) {
		return 'unavailable';
	}
	return 'degraded';
}

function getConfiguredServiceCount(
	services: readonly PublicConfiguredServiceStatus[]
): number {
	return services.filter((service) => service.configured).length;
}

function formatServiceDetail(
	service: PublicConfiguredServiceStatus,
	usesExternalFallback: boolean
): string {
	if (service.configured) return service.url ?? 'Configured';
	if (usesExternalFallback && service.url !== null) {
		return `External fallback only: ${service.url}`;
	}
	return 'No StellarAtlas-owned target configured';
}

function archiveScanTone(scan: PublicArchiveScanLogEntry): PublicStatusLevel {
	if (scan.scanStatus === 'ok') return 'ok';
	return 'degraded';
}

function archiveScanLabel(scan: PublicArchiveScanLogEntry): string {
	if (scan.scanStatus === 'ok') return 'No archive errors';
	if (scan.scanStatus === 'worker_issue') return 'Worker issue';
	return 'Archive error';
}

function archiveScanDetail(scan: PublicArchiveScanLogEntry): string {
	const rangeEnd =
		scan.toLedger === null ? 'latest' : formatInteger(scan.toLedger);
	const range = `${formatInteger(scan.fromLedger)}-${rangeEnd}`;
	const duration = formatDuration(scan.durationMs);
	const errorText =
		scan.errorCount === 0
			? 'run completed with no archive errors'
			: `${formatInteger(scan.errorCount)} errors`;

	return `${range}, verified ${formatInteger(scan.latestVerifiedLedger)}, ${formatInteger(scan.concurrency)} workers, ${duration}, ${errorText}`;
}

function formatArchiveUrl(value: string): string {
	try {
		const url = new URL(value);
		return url.hostname;
	} catch {
		return value;
	}
}

function statusTone(status: PublicStatusLevel): 'good' | 'warning' | 'danger' {
	if (status === 'ok') return 'good';
	if (status === 'degraded') return 'warning';
	return 'danger';
}

function statusLabel(status: PublicStatusLevel): string {
	if (status === 'ok') return 'OK';
	if (status === 'degraded') return 'Degraded';
	return 'Unavailable';
}

function serviceLabel(
	service: PublicConfiguredServiceStatus['service']
): string {
	if (service === 'frontend') return 'Frontend';
	if (service === 'horizon') return 'Horizon';
	if (service === 'rpc') return 'RPC';
	const exhaustive: never = service;
	return exhaustive;
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
