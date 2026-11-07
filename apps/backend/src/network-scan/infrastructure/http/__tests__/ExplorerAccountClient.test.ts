import { jest } from '@jest/globals';
import { StrKey } from '@stellar/stellar-sdk';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fetchExplorerAccount } from '../ExplorerAccountClient.js';
import { readHorizonAccountJson } from '../HorizonAccountResponse.js';

const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const muxed = StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 5));
const publicNetworkDescriptor = 'Test SDF Network ; September 2015';
const detail = () => ({
	networkPassphrase: publicNetworkDescriptor,
	signal: new AbortController().signal
});

it('uses the exact configured private origin and prefix for classic and muxed search and detail', async () => {
	const target = 'http://[::1]:8090/internal/horizon';
	for (const id of [account, muxed]) {
		for (const options of [undefined, detail()]) {
			const transport = jest.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
				account_id: id,
				sequence: '1',
				subentry_count: 0,
				balances: []
			}));
			await expect(fetchExplorerAccount(target, id, options, transport))
				.resolves.toMatchObject({ accountId: id, sequence: '1', source: 'horizon' });
			expect(transport).toHaveBeenCalledTimes(1);
			expect(String(transport.mock.calls[0]?.[0])).toBe(target + '/accounts/' + id);
			expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
		}
	}
});

it('rejects traversal, delimiters, encoding and noncanonical StrKeys without transport', async () => {
	const transport = jest.fn<typeof fetch>();
	for (const input of [
		'../health', '%2e%2e%2fhealth', '//outside.invalid', 'https://outside.invalid',
		account + '/x', account + '%2Fx', account + '\\x', account + '?x', account + '#x',
		account + '\n', account.toLowerCase(), 'G' + 'A'.repeat(55), 'M' + 'A'.repeat(68)
	]) {
		await expect(fetchExplorerAccount('https://horizon.example/', input, undefined, transport))
			.resolves.toBeNull();
	}
	expect(transport).not.toHaveBeenCalled();
});

it('rejects malformed or ambiguous operator bases without transport', async () => {
	const transport = jest.fn<typeof fetch>();
	for (const target of [
		'/internal', 'ftp://horizon.example', 'https:///prefix', 'https://example.invalid:99999',
		'https://@example.invalid/', 'https://user:pw@example.invalid/', 'https://horizon.example/?',
		'https://horizon.example/#', 'https://horizon.example\\@outside.invalid/',
		'https://horizon.example/prefix/%2e%2e/other', 'https://horizon.example/internal%2fpath'
	]) {
		await expect(fetchExplorerAccount(target, account, undefined, transport)).rejects.toThrow();
	}
	expect(transport).not.toHaveBeenCalled();
});

it('never makes a second HTTP hop on a redirect in any account lookup mode', async () => {
	const paths: Array<string | undefined> = [];
	const server = createServer((req, res) => {
		paths.push(req.url);
		if (req.url === '/redirect-target') {
			res.writeHead(500).end();
			return;
		}
		res.writeHead(302, { Location: '/redirect-target' }).end();
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	try {
		const address = server.address();
		if (address === null || typeof address === 'string') throw new Error('No fixture port');
		const target = 'http://127.0.0.1:' + address.port + '/horizon/';
		for (const id of [account, muxed])
			for (const options of [undefined, detail()])
				await expect(fetchExplorerAccount(target, id, options)).rejects.toThrow();
		expect(paths).toEqual([account, account, muxed, muxed].map(id => '/horizon/accounts/' + id));
	} finally {
		const closed = once(server, 'close');
		server.close();
		server.closeAllConnections();
		await closed;
	}
});

it('respects caller cancellation before and during a provider read', async () => {
	const controller = new AbortController();
	const options = { ...detail(), signal: controller.signal };
	const transport = jest.fn<typeof fetch>().mockImplementationOnce((_url, init) =>
		new Promise((_resolve, reject) => {
			const signal = init?.signal;
			signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
		})
	);
	const result = fetchExplorerAccount('https://horizon.example', muxed, options, transport);
	controller.abort(new Error('Client disconnected'));
	await expect(result).rejects.toThrow('Client disconnected');
	await expect(fetchExplorerAccount('https://horizon.example', muxed, options, transport))
		.rejects.toThrow('Client disconnected');
	expect(transport).toHaveBeenCalledTimes(1);
});

it('bounds complete upstream parsing and cancels an aborted or oversized body', async () => {
	const signal = new AbortController().signal;
	await expect(readHorizonAccountJson(Response.json({ exact: '9223372036854775807' }), signal))
		.resolves.toEqual({ exact: '9223372036854775807' });
	await expect(readHorizonAccountJson(new Response('{}', { headers: { 'content-length': '2097153' } }), signal)).rejects.toThrow();
	await expect(readHorizonAccountJson(new Response(new Uint8Array(2097153)), signal)).rejects.toThrow();
	await expect(readHorizonAccountJson(new Response('{"partial":'), signal)).rejects.toThrow();
	await expect(readHorizonAccountJson(new Response(new Uint8Array([0xff])), signal)).rejects.toThrow();
	const abort = new AbortController(), cancel = jest.fn();
	const pending = readHorizonAccountJson(new Response(new ReadableStream({ cancel })), abort.signal);
	abort.abort(new Error('Closed'));
	await expect(pending).rejects.toThrow('Closed');
	expect(cancel).toHaveBeenCalledTimes(1);
	let finishCancel!: () => void;
	const cancellation = new Promise<void>(resolve => { finishCancel = resolve; });
	const last = new AbortController();
	const draining = readHorizonAccountJson(new Response(new ReadableStream({ cancel: () => cancellation })), last.signal);
	let settled = false;
	void draining.catch(() => { settled = true; });
	last.abort(new Error('Draining'));
	await new Promise(resolve => setImmediate(resolve));
	expect(settled).toBe(false);
	finishCancel();
	await expect(draining).rejects.toThrow('Draining');
});
