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
			url: 'https://stellaratlas.io',
			probe: 'not_run'
		});
	});

	it('should report missing frontend status as unavailable', () => {
		const result = new GetFrontendStatus({} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			service: 'frontend',
			configured: false,
			url: null,
			probe: 'not_run'
		});
	});

	it('should report configured Horizon status from required config', () => {
		const result = new GetHorizonStatus({
			horizonUrl: { value: 'https://horizon.example.com' }
		} as Config).execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'ok',
			service: 'horizon',
			configured: true,
			url: 'https://horizon.example.com',
			probe: 'not_run'
		});
	});

	it('should report configured and missing RPC status', () => {
		const configured = new GetRpcStatus({
			rpcUrl: { value: 'https://rpc.example.com' }
		} as Config).execute();
		const missing = new GetRpcStatus({} as Config).execute();

		expect(configured._unsafeUnwrap()).toMatchObject({
			status: 'ok',
			service: 'rpc',
			configured: true,
			url: 'https://rpc.example.com'
		});
		expect(missing._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			service: 'rpc',
			configured: false,
			url: null
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
