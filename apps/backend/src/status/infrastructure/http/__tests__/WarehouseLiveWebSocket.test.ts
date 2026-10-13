import {
	parseWarehousePublicationMessage,
	resolveWarehouseNatsSettings
} from '../WarehouseLiveWebSocket.js';

describe('warehouse publication WebSocket message parsing', () => {
	it('rejects malformed and oversized NATS messages before broadcast', () => {
		expect(parseWarehousePublicationMessage(Buffer.from('{bad'))).toBeNull();
		expect(parseWarehousePublicationMessage(Buffer.alloc(4_097))).toBeNull();
		expect(
			parseWarehousePublicationMessage(
				Buffer.from(
					JSON.stringify({
						version: 1,
						event: 'datasets.published',
						batchId: 'invalid',
						minLedger: 2,
						maxLedger: 3,
						publishedAt: new Date().toISOString(),
						datasets: ['accounts']
					})
				)
			)
		).toBeNull();
	});
});

describe('warehouse NATS settings', () => {
	it('loads only the endpoint and token from the optional dotenv config', () => {
		expect(
			resolveWarehouseNatsSettings(
				{},
				'NATS_TOKEN=file-secret\nOTHER=value\nWAREHOUSE_NATS_URL=nats://bridge:4222'
			)
		).toEqual({
			servers: ['nats://bridge:4222'],
			token: 'file-secret'
		});
	});

	it('gives process environment values precedence over the config file', () => {
		expect(
			resolveWarehouseNatsSettings(
				{
					WAREHOUSE_NATS_URL: 'nats://environment:4222',
					NATS_TOKEN: 'environment-secret'
				},
				'NATS_TOKEN=file-secret\nWAREHOUSE_NATS_URL=nats://file:4222'
			)
		).toEqual({
			servers: ['nats://environment:4222'],
			token: 'environment-secret'
		});
	});

	it('uses loopback only when the optional file is missing', () => {
		expect(resolveWarehouseNatsSettings({})).toEqual({
			servers: ['nats://127.0.0.1:4222']
		});
		expect(() => resolveWarehouseNatsSettings({}, 'NATS_TOKEN=secret')).toThrow(
			'warehouse NATS endpoint is not configured'
		);
	});
});
