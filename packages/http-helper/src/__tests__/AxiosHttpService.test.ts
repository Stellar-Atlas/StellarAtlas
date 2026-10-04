import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AxiosHttpService } from '../AxiosHttpService.js';
import { Url } from '../Url.js';

describe('HTTP response deadlines', () => {
	let server: Server;
	let url: Url;
	beforeEach(async () => {
		server = createServer((_request, response) => {
			const timer = setTimeout(() => response.end('{"ok":true}'), 80);
			response.once('close', () => clearTimeout(timer));
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		if (address === null || typeof address === 'string')
			throw new Error('Missing test port');
		const parsed = Url.create(`http://127.0.0.1:${address.port}`);
		if (parsed.isErr()) throw parsed.error;
		url = parsed.value;
	});
	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	});
	it('uses an explicit response budget rather than cancelling a healthy request at the old connect budget', async () => {
		const result = await new AxiosHttpService('test').get(url, {
			connectionTimeoutMs: 5,
			requestTimeoutMs: 1000,
			socketTimeoutMs: 1000,
			proxy: false
		});
		expect(result.isOk()).toBe(true);
		if (result.isOk()) expect(result.value.data).toEqual({ ok: true });
	});
	it('identifies a local deadline precisely, rather than claiming a connection failure', async () => {
		const result = await new AxiosHttpService('test').get(url, {
			requestTimeoutMs: 10,
			socketTimeoutMs: 1000,
			proxy: false
		});
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error.code).toBe('ETIMEDOUT');
			expect(result.error.message).toContain(
				'10ms waiting for complete response'
			);
			expect(result.error.message).not.toContain('SB Connection');
		}
	});
	it('preserves caller cancellation as distinct from a timed-out request', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await new AxiosHttpService('test').get(url, {
			abortSignal: controller.signal,
			proxy: false
		});
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.code).toBe('ERR_CANCELED');
	});
});
