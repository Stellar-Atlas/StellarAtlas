import type {
	PublicApiStatus,
	PublicArchiveScanLogEntry,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicFailoverStatus,
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

interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly dataQuality: PublicDataQualityStatus;
	readonly failover: PublicFailoverStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly horizon: PublicConfiguredServiceStatus;
	readonly rpc: PublicConfiguredServiceStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	dataQuality,
	failover,
	frontend,
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
	const configuredServiceCount =
		services.filter((service) => service.configured).length +
		(failover.configured ? 1 : 0);

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
					detail={`${formatNullablePercent(scan.expectedCompletionRate)} of expected cadence`}
					label="Network scans"
					tone={statusTone(scan.status)}
					value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.expectedScans)}`}
				/>
				<StatCard
					detail={`${formatInteger(rollups.rawCompletedScans)} raw scans, ${formatInteger(rollups.rollupCrawlCount)} rolled up`}
					label="Daily rollups"
					tone={statusTone(rollups.status)}
					value={`${formatInteger(rollups.matchingDays)} / ${formatInteger(rollups.windowDays)}`}
				/>
				<StatCard
					detail={`${formatInteger(archiveQueue.staleJobs)} stale jobs`}
					label="Archive queue"
					tone={statusTone(archiveQueue.status)}
					value={formatInteger(archiveQueue.totalUnfinishedJobs)}
				/>
				<StatCard
					detail={`${formatInteger(workers.archiveWorkers.staleWorkers)} stale workers`}
					label="Archive workers"
					tone={statusTone(workers.status)}
					value={formatInteger(workers.archiveWorkers.activeWorkers)}
				/>
				<StatCard
					detail="Targets configured locally"
					label="Service targets"
					tone={statusTone(serviceStatus)}
					value={`${formatInteger(configuredServiceCount)} / 4`}
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
							detail={`${formatInteger(scan.incompleteScans)} incomplete raw scans`}
							label="Scan completion"
							status={scan.status}
							value={formatNullablePercent(scan.completionRate)}
						/>
						<StatusRow
							detail={`${formatInteger(rollups.missingRollupDays)} missing, ${formatInteger(rollups.mismatchedRollupDays)} mismatched`}
							label="Rollup match"
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
							detail={`${formatInteger(archiveQueue.pendingJobs)} pending, ${formatInteger(archiveQueue.activeJobs)} active`}
							label="Archive queue"
							status={archiveQueue.status}
							value={`${formatInteger(archiveQueue.totalUnfinishedJobs)} jobs`}
						/>
						<StatusRow
							detail={`${formatInteger(workers.archiveWorkers.totalTakenJobs)} taken jobs`}
							label="Archive workers"
							status={workers.archiveWorkers.status}
							value={`${formatInteger(workers.archiveWorkers.activeWorkers)} active`}
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
							<strong>Service Targets</strong>
							<span>Configuration status</span>
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
	status,
	value
}: {
	readonly detail: string;
	readonly label: string;
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
				<StatusPill status={status} />
			</div>
		</div>
	);
}

function ServiceRow({
	service
}: {
	readonly service: PublicConfiguredServiceStatus;
}): React.JSX.Element {
	return (
		<StatusRow
			detail={service.url ?? 'No target configured'}
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
			: 'No failover target configured';

	return (
		<StatusRow
			detail={detail}
			label="Failover"
			status={failover.status}
			value={
				failover.complete
					? 'Complete'
					: failover.configured
						? 'Partial'
						: 'Missing'
			}
		/>
	);
}

function StatusPill({
	status
}: {
	readonly status: PublicStatusLevel;
}): React.JSX.Element {
	return (
		<span className={`status-pill ${statusTone(status)}`}>
			{statusLabel(status)}
		</span>
	);
}

function serviceGroupStatus(
	services: readonly PublicConfiguredServiceStatus[],
	failover: PublicFailoverStatus
): PublicStatusLevel {
	const statuses = [
		...services.map((service) => service.status),
		failover.status
	];
	if (statuses.every((status) => status === 'ok')) return 'ok';
	if (statuses.every((status) => status === 'unavailable')) {
		return 'unavailable';
	}
	return 'degraded';
}

function archiveScanTone(scan: PublicArchiveScanLogEntry): PublicStatusLevel {
	if (scan.scanStatus === 'ok') return 'ok';
	if (scan.scanStatus === 'worker_issue') return 'degraded';
	return 'unavailable';
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
