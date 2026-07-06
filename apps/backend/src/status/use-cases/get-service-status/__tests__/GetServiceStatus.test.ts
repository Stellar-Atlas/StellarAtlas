import type { Config } from '@core/config/Config.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '../GetServiceStatus.js';

describe('GetServiceStatus', () => {
	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should report configured frontend status without probing it', () => {
		const result = new GetFrontendStatus({
			frontendBaseUrl: 'https://stellaratlas.io'
		} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			service: 'frontend',
			configured: true,
			configurationState: 'configured',
			health: 'not_probed',
			url: 'https://stellaratlas.io',
			probe: 'not_run',
			readiness: 'configured_not_probed',
			requiredForProduction: true
		});
	});

	it('should report missing frontend status as unavailable', () => {
		const result = new GetFrontendStatus({} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			service: 'frontend',
			configured: false,
			configurationState: 'not_configured',
			health: 'not_probed',
			url: null,
			probe: 'not_run',
			readiness: 'planned',
			requiredForProduction: true
		});
	});

	it('should report configured Horizon as unprobed local readiness', () => {
		const result = new GetHorizonStatus({
			horizonUrl: { value: 'http://127.0.0.1:8000' }
		} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'degraded',
			service: 'horizon',
			configured: true,
			configurationState: 'configured',
			health: 'not_probed',
			url: 'http://127.0.0.1:8000',
			probe: 'not_run',
			readiness: 'configured_not_probed',
			requiredForProduction: true
		});
	});

	it('should not count public Horizon fallback as deployed StellarAtlas Horizon', () => {
		const result = new GetHorizonStatus({
			horizonUrl: { value: 'https://horizon.stellar.org' }
		} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'degraded',
			service: 'horizon',
			configured: false,
			configurationState: 'external_fallback',
			health: 'not_probed',
			url: 'https://horizon.stellar.org',
			probe: 'not_run',
			readiness: 'external_fallback',
			requiredForProduction: false
		});
	});

	it('should report configured and missing RPC status', () => {
		const configured = new GetRpcStatus({
			rpcUrl: { value: 'https://rpc.example.com' }
		} as Config).execute();
		const missing = new GetRpcStatus({} as Config).execute();

		expect(configured._unsafeUnwrap()).toMatchObject({
			status: 'degraded',
			service: 'rpc',
			configured: true,
			configurationState: 'configured',
			health: 'not_probed',
			url: 'https://rpc.example.com',
			readiness: 'configured_not_probed',
			requiredForProduction: true
		});
		expect(missing._unsafeUnwrap()).toMatchObject({
			status: 'degraded',
			service: 'rpc',
			configured: false,
			configurationState: 'not_configured',
			health: 'not_probed',
			url: null,
			readiness: 'planned',
			requiredForProduction: false
		});
	});

	it('should report failover completeness without probing targets', () => {
		const complete = new GetFailoverStatus({
			failoverFrontendBaseUrl: { value: 'https://aws.example.com' },
			failoverApiBaseUrl: { value: 'https://aws-api.example.com' }
		} as Config).execute();
		const partial = new GetFailoverStatus({
			failoverFrontendBaseUrl: { value: 'https://aws.example.com' }
		} as Config).execute();
		const missing = new GetFailoverStatus({} as Config).execute();

		expect(complete._unsafeUnwrap()).toMatchObject({
			status: 'ok',
			service: 'failover',
			configured: true,
			complete: true,
			probe: 'not_run'
		});
		expect(partial._unsafeUnwrap()).toMatchObject({
			status: 'degraded',
			configured: true,
			complete: false,
			frontendUrl: 'https://aws.example.com',
			apiUrl: null
		});
		expect(missing._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			configured: false,
			complete: false,
			frontendUrl: null,
			apiUrl: null
		});
	});
});
