import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectQueue,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime, formatInteger } from '@format/formatters';
import { StatusPill, StatusRow, statusLabel } from './status-ui';

interface ProductionServiceStatusPanelProps {
	readonly api: PublicApiStatus;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
}

export function ProductionServiceStatusPanel({
	api,
	archiveObjects,
	dataQuality,
	frontend
}: ProductionServiceStatusPanelProps): React.JSX.Element {
	const networkScan = dataQuality.dataFreshness.networkScan;
	const archiveObjectStatus = getArchiveObjectStatus(archiveObjects);

	return (
		<section className="panel status-services-panel">
			<div className="panel-heading">
				<div>
					<strong>Production Critical Services</strong>
					<span>Frontend, API, network scanner, and archive object verifier runtime</span>
				</div>
				<StatusPill
					status={criticalServiceStatus(
						api,
						frontend,
						networkScan.status,
						archiveObjectStatus
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
					detail={`${formatInteger(archiveObjects.activeObjects)} active objects, ${formatInteger(archiveObjects.pendingObjects)} pending, ${formatInteger(archiveObjects.failedObjects)} archive evidence failures`}
					label="Archive scanner"
					status={archiveObjectStatus}
					value={`${formatInteger(archiveObjects.activeObjects)} active`}
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

function getArchiveObjectStatus(
	objects: PublicHistoryArchiveObjectQueue
): PublicStatusLevel {
	return objects.activeObjects > 0 || objects.pendingObjects > 0 ? 'ok' : 'degraded';
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
