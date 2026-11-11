import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AxiosHttpService } from '../AxiosHttpService.js';
import { Url } from '../Url.js';
import { Agent } from 'node:http';

class InspectableHttpService extends AxiosHttpService {
	configuration(options: Parameters<AxiosHttpService['get']>[1]) {
		return this.mapHttpOptionsToAxiosRequestConfig(options);
	}
}

describe('public archive transport policy', () => {
	it('refuses literal private destinations before opening a connection', async () => {
		const result = await new AxiosHttpService('test').get(
			Url.create('http://127.0.0.1')._unsafeUnwrap(),
			{ publicArchive: true }
		);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.code).toBe('PUBLIC_ARCHIVE_POLICY');
	});
	it('owns agents, proxies, redirect policy and buffered state size only for archive requests', () => {
		const service = new InspectableHttpService('test');
		const callerAgent = new Agent();
		const internal = service.configuration({ httpAgent: callerAgent });
		expect(internal.httpAgent).toBe(callerAgent);
		expect(internal.beforeRedirect).toBeUndefined();
		expect(internal.maxContentLength).toBeUndefined();
		const archive = service.configuration({
			publicArchive: true,
			httpAgent: callerAgent
		});
		expect(archive.httpAgent).not.toBe(callerAgent);
		expect(archive.proxy).toBe(false);
		expect(archive.maxRedirects).toBe(3);
		expect(archive.maxContentLength).toBe(1024 * 1024);
		expect(archive.beforeRedirect).toBeDefined();
		expect(
			service.configuration({ publicArchive: true, responseType: 'stream' })
				.maxContentLength
		).toBeUndefined();
		callerAgent.destroy();
	});
});

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
	it.each(['get', 'head', 'delete'] as const)(
		'preserves the %s method and mapped request headers',
		async (method) => {
			let observedMethod: string | undefined;
			let observedHeader: string | string[] | undefined;
			server.on('request', (request) => {
				observedMethod = request.method;
				observedHeader = request.headers['x-release-check'];
			});
			const result = await new AxiosHttpService('test')[method](url, {
				proxy: false,
				requestTimeoutMs: 1000,
				headers: { 'X-Release-Check': 'mapped' }
			});
			expect(result.isOk()).toBe(true);
			expect(observedMethod).toBe(method.toUpperCase());
			expect(observedHeader).toBe('mapped');
		}
	);
	it('preserves the POST body and request configuration as separate arguments', async () => {
		const received = new Promise<{ method: string | undefined; body: string }>(
			(resolve) => {
				server.on('request', (request) => {
					let body = '';
					request.on('data', (chunk: Buffer) => {
						body += chunk.toString('utf8');
					});
					request.on('end', () => resolve({ method: request.method, body }));
				});
			}
		);
		const payload = { release: 'candidate', values: [1, 2] };
		const result = await new AxiosHttpService('test').post(url, payload, {
			proxy: false,
			requestTimeoutMs: 1000
		});
		expect(result.isOk()).toBe(true);
		const request = await received;
		expect(request.method).toBe('POST');
		expect(JSON.parse(request.body)).toEqual(payload);
	});
});
