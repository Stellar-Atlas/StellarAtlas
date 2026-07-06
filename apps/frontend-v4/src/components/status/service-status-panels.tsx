import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicFailoverStatus,
	PublicStatusLevel
} from '@api/types';
import { formatDateTime } from '@format/formatters';
import { StatusPill, StatusRow, statusLabel } from './status-ui';

interface ServiceStatusPanelsProps {
	readonly api: PublicApiStatus;
	readonly failover: PublicFailoverStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly horizon: PublicConfiguredServiceStatus;
	readonly rpc: PublicConfiguredServiceStatus;
}

export function ServiceStatusPanels({
	api,
	failover,
	frontend,
	horizon,
	rpc
}: ServiceStatusPanelsProps): React.JSX.Element {
	return (
		<>
			<section className="panel status-services-panel">
				<div className="panel-heading">
					<div>
						<strong>Production Critical Services</strong>
						<span>Live API status and required frontend configuration</span>
					</div>
					<StatusPill status={criticalServiceStatus(api, frontend)} />
				</div>
				<div className="status-list">
					<StatusRow
						detail={formatDateTime(api.generatedAt)}
						label="API origin"
						status={api.status}
						value={statusLabel(api.status)}
					/>
					<ServiceRow required service={frontend} />
				</div>
			</section>

			<section className="panel status-services-panel">
				<div className="panel-heading">
					<div>
						<strong>Roadmap And Optional Services</strong>
						<span>Not counted as production outages unless configured</span>
					</div>
					<StatusPill status={roadmapServiceStatus([horizon, rpc], failover)} />
				</div>
				<div className="status-list">
					<ServiceRow service={horizon} />
					<ServiceRow service={rpc} />
					<FailoverRow failover={failover} />
				</div>
			</section>
		</>
	);
}

function ServiceRow({
	required = false,
	service
}: {
	readonly required?: boolean;
	readonly service: PublicConfiguredServiceStatus;
}): React.JSX.Element {
	if (service.readiness === 'external_fallback') {
		return (
			<StatusRow
				detail={`External public fallback only; no StellarAtlas-owned target or live probe is deployed. Target ${service.url ?? 'unknown'}`}
				label={serviceLabel(service.service)}
				pillText="Fallback"
				status="ok"
				value="External fallback"
			/>
		);
	}

	if (!service.configured && !required) {
		return (
			<StatusRow
				detail="Roadmap service is not deployed for this environment; probe:not_run is expected."
				label={serviceLabel(service.service)}
				pillText="Planned"
				status="ok"
				value="Not deployed"
			/>
		);
	}

	if (!service.configured) {
		return (
			<StatusRow
				detail="Required production target is not configured; probe:not_run."
				label={serviceLabel(service.service)}
				pillText="Config missing"
				status="unavailable"
				value="Missing"
			/>
		);
	}

	return (
		<StatusRow
			detail={formatConfiguredServiceDetail(service)}
			label={serviceLabel(service.service)}
			pillText="probe:not_run"
			status="ok"
			value="Configured"
		/>
	);
}

function FailoverRow({
	failover
}: {
	readonly failover: PublicFailoverStatus;
}): React.JSX.Element {
	if (!failover.configured) {
		return (
			<StatusRow
				detail="Optional failover target is not configured; probe:not_run is expected."
				label="Failover"
				pillText="Optional"
				status="ok"
				value="Not configured"
			/>
		);
	}

	return (
		<StatusRow
			detail={`Configuration only; probe:not_run. ${formatFailoverTarget(failover)}`}
			label="Failover"
			pillText="probe:not_run"
			status="ok"
			value={failover.complete ? 'Complete' : 'Partial'}
		/>
	);
}

export function criticalServiceStatus(
	api: PublicApiStatus,
	frontend: PublicConfiguredServiceStatus
): PublicStatusLevel {
	const statuses: PublicStatusLevel[] = [
		api.status,
		frontend.configured ? frontend.status : 'unavailable'
	];
	if (statuses.every((status) => status === 'ok')) return 'ok';
	if (statuses.every((status) => status === 'unavailable')) {
		return 'unavailable';
	}
	return 'degraded';
}

function roadmapServiceStatus(
	services: readonly PublicConfiguredServiceStatus[],
	failover: PublicFailoverStatus
): PublicStatusLevel {
	if (
		services.some(
			(service) => service.configured && service.status === 'unavailable'
		) ||
		(failover.configured && failover.status === 'unavailable')
	) {
		return 'unavailable';
	}
	return 'ok';
}

function formatConfiguredServiceDetail(
	service: PublicConfiguredServiceStatus
): string {
	const target = service.url ?? 'configured target';
	return `Configuration only; probe:not_run. Target ${target}`;
}

function formatFailoverTarget(failover: PublicFailoverStatus): string {
	if (failover.complete) return `${failover.frontendUrl} + ${failover.apiUrl}`;
	return failover.frontendUrl ?? failover.apiUrl ?? 'Partial target';
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
