import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type { Config } from '@core/config/Config.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export type ServiceProbeMode = 'not_run';
export type ServiceConfigurationState =
	'configured' | 'external_fallback' | 'not_configured';
export type ServiceReadinessState =
	'configured_not_probed' | 'external_fallback' | 'planned';
export type ServiceHealthState = 'not_probed';

export interface ConfiguredServiceStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly service: 'frontend' | 'horizon' | 'rpc';
	readonly configured: boolean;
	readonly configurationState: ServiceConfigurationState;
	readonly health: ServiceHealthState;
	readonly url: string | null;
	readonly probe: ServiceProbeMode;
	readonly readiness: ServiceReadinessState;
	readonly requiredForProduction: boolean;
}

export interface FailoverStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly service: 'failover';
	readonly configured: boolean;
	readonly complete: boolean;
	readonly frontendUrl: string | null;
	readonly apiUrl: string | null;
	readonly probe: ServiceProbeMode;
}

@injectable()
export class GetFrontendStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<ConfiguredServiceStatusDTO, Error> {
		return ok(
			mapConfiguredServiceStatus('frontend', this.config.frontendBaseUrl, {
				reportConfiguredAsOk: true,
				requiredForProduction: true
			})
		);
	}
}

@injectable()
export class GetHorizonStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<ConfiguredServiceStatusDTO, Error> {
		const horizonUrl = this.config.horizonUrl.value;
		if (isPublicHorizonFallback(horizonUrl)) {
			return ok(mapExternalFallbackStatus('horizon', horizonUrl));
		}

		return ok(
			mapConfiguredServiceStatus('horizon', horizonUrl, {
				reportConfiguredAsOk: false,
				requiredForProduction: true
			})
		);
	}
}

@injectable()
export class GetRpcStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<ConfiguredServiceStatusDTO, Error> {
		return ok(
			mapConfiguredServiceStatus('rpc', this.config.rpcUrl?.value, {
				reportConfiguredAsOk: false,
				requiredForProduction: this.config.rpcUrl !== undefined
			})
		);
	}
}

@injectable()
export class GetFailoverStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<FailoverStatusDTO, Error> {
		const frontendUrl = this.config.failoverFrontendBaseUrl?.value ?? null;
		const apiUrl = this.config.failoverApiBaseUrl?.value ?? null;
		const configured = frontendUrl !== null || apiUrl !== null;
		const complete = frontendUrl !== null && apiUrl !== null;

		return ok({
			generatedAt: new Date().toISOString(),
			status: complete ? 'ok' : configured ? 'degraded' : 'unavailable',
			service: 'failover',
			configured,
			complete,
			frontendUrl,
			apiUrl,
			probe: 'not_run'
		});
	}
}

function mapConfiguredServiceStatus(
	service: ConfiguredServiceStatusDTO['service'],
	url: string | undefined,
	options: {
		readonly reportConfiguredAsOk: boolean;
		readonly requiredForProduction: boolean;
	}
): ConfiguredServiceStatusDTO {
	const configured = url !== undefined && url.trim().length > 0;
	return {
		generatedAt: new Date().toISOString(),
		status: configured
			? options.reportConfiguredAsOk
				? 'ok'
				: 'degraded'
			: options.requiredForProduction
				? 'unavailable'
				: 'degraded',
		service,
		configured,
		configurationState: configured ? 'configured' : 'not_configured',
		health: 'not_probed',
		url: configured ? url : null,
		probe: 'not_run',
		readiness: configured ? 'configured_not_probed' : 'planned',
		requiredForProduction: options.requiredForProduction
	};
}

function mapExternalFallbackStatus(
	service: ConfiguredServiceStatusDTO['service'],
	url: string
): ConfiguredServiceStatusDTO {
	return {
		generatedAt: new Date().toISOString(),
		status: 'degraded',
		service,
		configured: false,
		configurationState: 'external_fallback',
		health: 'not_probed',
		url,
		probe: 'not_run',
		readiness: 'external_fallback',
		requiredForProduction: false
	};
}

function isPublicHorizonFallback(url: string): boolean {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		return (
			hostname === 'horizon.stellar.org' ||
			hostname === 'horizon-testnet.stellar.org'
		);
	} catch {
		return false;
	}
}
