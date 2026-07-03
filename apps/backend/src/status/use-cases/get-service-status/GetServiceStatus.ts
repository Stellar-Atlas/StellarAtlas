import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type { Config } from '@core/config/Config.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export type ServiceProbeMode = 'not_run';

export interface ConfiguredServiceStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly service: 'frontend' | 'horizon' | 'rpc';
	readonly configured: boolean;
	readonly url: string | null;
	readonly probe: ServiceProbeMode;
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
			mapConfiguredServiceStatus('frontend', this.config.frontendBaseUrl)
		);
	}
}

@injectable()
export class GetHorizonStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<ConfiguredServiceStatusDTO, Error> {
		return ok(
			mapConfiguredServiceStatus('horizon', this.config.horizonUrl.value)
		);
	}
}

@injectable()
export class GetRpcStatus {
	constructor(@inject('Config') private readonly config: Config) {}

	execute(): Result<ConfiguredServiceStatusDTO, Error> {
		return ok(mapConfiguredServiceStatus('rpc', this.config.rpcUrl?.value));
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
	url: string | undefined
): ConfiguredServiceStatusDTO {
	const configured = url !== undefined && url.trim().length > 0;
	return {
		generatedAt: new Date().toISOString(),
		status: configured ? 'ok' : 'unavailable',
		service,
		configured,
		url: configured ? url : null,
		probe: 'not_run'
	};
}
