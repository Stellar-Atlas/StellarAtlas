import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicStatusLevel,
	PublicWorkerStatus
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill, StatusRow, statusLabel } from './status-ui';

interface ProductionServiceStatusPanelProps {
	readonly api: PublicApiStatus;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly workers: PublicWorkerStatus;
}

export function ProductionServiceStatusPanel({
	api,
	dataQuality,
	frontend,
	workers
}: ProductionServiceStatusPanelProps): React.JSX.Element {
	const networkScan = dataQuality.dataFreshness.networkScan;
	const archiveQueue = dataQuality.archiveQueue;
	const archiveWorkerStatus = getWorstStatus([
		workers.archiveWorkers.status,
		archiveQueue.status
	]);

	return (
		<section className="panel status-services-panel">
			<div className="panel-heading">
				<div>
					<strong>Production Critical Services</strong>
					<span>Frontend, API, network scanner, and archive worker runtime</span>
				</div>
				<StatusPill
					status={criticalServiceStatus(
						api,
						frontend,
						networkScan.status,
						archiveWorkerStatus
					)}
				/>
			</div>
			<div className="status-list">
				<StatusRow
					detail={formatDateTime(api.generatedAt)}
					label="API origin"
					status={api.status}
					value={statusLabel(api.status)}
				/>
				<StatusRow
					detail="This page rendered from the production frontend."
					label="Frontend"
					status={frontend.configured ? 'ok' : 'unavailable'}
					value={frontend.configured ? 'Online' : 'Missing'}
				/>
				<StatusRow
					detail={`Latest successful scan ${formatFreshness(networkScan.latestAt, networkScan.ageMs)}`}
					label="Network scanner"
					status={networkScan.status}
					value={statusLabel(networkScan.status)}
				/>
				<StatusRow
					detail={`${formatInteger(workers.archiveWorkers.activeWorkers)} active worker leases, ${formatInteger(workers.archiveWorkers.staleWorkers)} stale; ${formatInteger(archiveQueue.pendingJobs)} queued`}
					label="Archive scanner"
					status={archiveWorkerStatus}
					value={`${formatInteger(workers.archiveWorkers.totalTakenJobs)} claimed`}
				/>
			</div>
		</section>
	);
}

export function criticalServiceStatus(
	api: PublicApiStatus,
	frontend: PublicConfiguredServiceStatus,
	networkScannerStatus: PublicStatusLevel,
	archiveScannerStatus: PublicStatusLevel
): PublicStatusLevel {
	const statuses: PublicStatusLevel[] = [
		api.status,
		frontend.configured ? 'ok' : 'unavailable',
		networkScannerStatus,
		archiveScannerStatus
	];
	return getWorstStatus(statuses);
}

function getWorstStatus(statuses: readonly PublicStatusLevel[]): PublicStatusLevel {
	if (statuses.some((status) => status === 'unavailable')) return 'unavailable';
	if (statuses.some((status) => status === 'degraded')) return 'degraded';
	return 'ok';
}

function formatFreshness(latestAt: string | null, ageMs: number | null): string {
	if (latestAt === null) return 'not recorded';
	return `${formatDateTime(latestAt)} (${formatDuration(ageMs)})`;
}

function formatDuration(value: number | null): string {
	if (value === null) return 'age unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 1) return '<1 min old';
	if (minutes < 60) return `${formatInteger(minutes)} min old`;
	return `${formatInteger(Math.round(minutes / 60))} hr old`;
}
