import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicStatusLevel
} from '@api/types';
import { assessArchiveHealth } from '@domain/history-archive-health';
import { formatDateTime, formatInteger } from '@format/formatters';
import {
	ArchiveHealthRow,
	StatusPill,
	StatusRow,
	statusLabel
} from './status-ui';

interface ProductionServiceStatusPanelProps {
	readonly api: PublicApiStatus;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveSummary: PublicHistoryArchiveObjectSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
}

export function ProductionServiceStatusPanel({
	api,
	archiveObjects,
	archiveSummary,
	dataQuality,
	frontend
}: ProductionServiceStatusPanelProps): React.JSX.Element {
	const networkScan = dataQuality.dataFreshness.networkScan;
	const archiveHealth = assessArchiveHealth({
		evidenceAvailable: true,
		summary: archiveSummary
	});

	return (
		<section className="panel status-services-panel">
			<div className="panel-heading">
				<div>
					<strong>Production services</strong>
					<span>Frontend, API, and network scanner runtime</span>
				</div>
				<StatusPill
					status={criticalServiceStatus(api, frontend, networkScan.status)}
				/>
			</div>
			<div className="status-list">
				<StatusRow
					detail={formatDateTime(api.generatedAt)}
					label="API"
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
				<ArchiveHealthRow
					detail={`${formatInteger(archiveSummary.verifiedObjects)} verified checks; ${formatInteger(archiveSummary.activeObjects)} checking now; ${formatInteger(archiveSummary.failedObjects)} remote failures; ${formatInteger(archiveObjects.objects.length)} recent rows shown`}
					label="Archive evidence"
					state={archiveHealth.state}
					value={`${formatInteger(archiveSummary.sources.length)} sources`}
				/>
			</div>
		</section>
	);
}

export function criticalServiceStatus(
	api: PublicApiStatus,
	frontend: PublicConfiguredServiceStatus,
	networkScannerStatus: PublicStatusLevel
): PublicStatusLevel {
	const statuses: PublicStatusLevel[] = [
		api.status,
		frontend.configured ? 'ok' : 'unavailable',
		networkScannerStatus
	];
	return getWorstStatus(statuses);
}

function getWorstStatus(
	statuses: readonly PublicStatusLevel[]
): PublicStatusLevel {
	if (statuses.some((status) => status === 'unavailable')) return 'unavailable';
	if (statuses.some((status) => status === 'degraded')) return 'degraded';
	return 'ok';
}

function formatFreshness(
	latestAt: string | null,
	ageMs: number | null
): string {
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
