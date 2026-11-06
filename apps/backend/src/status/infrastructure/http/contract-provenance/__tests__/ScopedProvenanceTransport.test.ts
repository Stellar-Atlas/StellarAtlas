import { Networks, StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { contractProvenanceRouter } from '../ContractProvenanceRouter.js';
import {
	fetchGithubAttestations,
	fetchRpcJson
} from '../BoundedProvenanceJson.js';
import { scopedRpcEndpoint } from '../ProvenanceEndpointPolicy.js';

const { jest: mocks } = import.meta as ImportMeta & { jest: typeof jest };
const upstream = 'https://scoped.example.invalid/exact';
const native = 'https://native.example.invalid/rpc';
const path =
	'/v1/contracts/' + StrKey.encodeContract(new Uint8Array(32)) + '/provenance';

function transport(statusCode: number, chunks: Buffer[] = []) {
	const observed: { url: string; body: string }[] = [];
	const mock = mocks.spyOn(https, 'request').mockImplementation(((
		destination: URL,
		_options: unknown,
		handleResponse: (response: unknown) => void
	) => {
		const outbound = Object.assign(new EventEmitter(), {
			write(payload: Buffer) {
				observed.push({ url: destination.href, body: payload.toString() });
			},
			end() {
				queueMicrotask(() => {
					const incoming = Object.assign(new PassThrough(), {
						statusCode,
						headers: { 'content-type': 'application/json', location: native }
					});
					handleResponse(incoming);
					for (const chunk of chunks) {
						if (incoming.destroyed) break;
						incoming.write(chunk);
					}
					if (!incoming.destroyed) incoming.end();
				});
			},
			destroy: mocks.fn()
		});
		return outbound;
	}) as unknown as typeof https.request);
	return { mock, observed };
}

let monotonicTime = performance.now();
beforeEach(() => {
	monotonicTime += 20_000;
	mocks.spyOn(performance, 'now').mockImplementation(() => monotonicTime);
});
afterEach(() => mocks.restoreAllMocks());

it.each([302, 429])(
	'does not redirect, retry or fall back after HTTPS %i',
	async (statusCode) => {
		const { observed, mock } = transport(statusCode);
		const app = express().use(
			'/v1',
			contractProvenanceRouter({
				rpcUrl: native,
				approvedNativeRpcUrl: native,
				provenanceRpcUrl: upstream,
				approvedProvenanceRpcUrl: upstream,
				networkPassphrase: Networks.PUBLIC
			})
		);
		const response = await request(app).get(path).expect(503);
		expect(response.body.code).toBe('contract_evidence_unavailable');
		expect(response.headers['cache-control']).toBe('no-store');
		expect(response.headers['retry-after']).toBe('30');
		expect(mock).toHaveBeenCalledTimes(1);
		expect(observed).toEqual([
			{
				url: upstream,
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getNetwork' })
			}
		]);
	}
);

it('keeps native routing and response behavior when the setting is absent', async () => {
	const { observed } = transport(200, [
		Buffer.from(
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result: { latestLedger: 150, entries: [] }
			})
		)
	]);
	const app = express().use(
		'/v1',
		contractProvenanceRouter({
			rpcUrl: native,
			approvedNativeRpcUrl: native,
			networkPassphrase: Networks.TESTNET
		})
	);
	const response = await request(app).get(path).expect(200);
	expect(response.headers['cache-control']).toBe('public, max-age=30');
	expect(response.body).not.toHaveProperty('ledgerEvidence');
	expect(response.body.build.status).toBe('not_found_at_ledger');
	expect(observed).toHaveLength(1);
	expect(observed[0]?.url).toBe(native);
	expect(JSON.parse(observed[0]!.body).method).toBe('getLedgerEntries');
});

it('does not open a connection for an invalid opt-in, even with a native URL', async () => {
	const { mock } = transport(200);
	const app = express().use(
		'/v1',
		contractProvenanceRouter({
			rpcUrl: native,
			approvedNativeRpcUrl: native,
			provenanceRpcUrl: '',
			networkPassphrase: Networks.PUBLIC
		})
	);
	await request(app).get(path).expect(503);
	expect(mock).not.toHaveBeenCalled();
});

it('does not use an otherwise valid scoped endpoint unless independently approved', async () => {
	const { mock } = transport(200);
	const app = express().use(
		'/v1',
		contractProvenanceRouter({
			rpcUrl: native,
			approvedNativeRpcUrl: native,
			provenanceRpcUrl: upstream,
			approvedProvenanceRpcUrl: upstream + '/other',
			networkPassphrase: Networks.PUBLIC
		})
	);
	await request(app).get(path).expect(503);
	expect(mock).not.toHaveBeenCalled();
});

it('attaches the checked lookup to HTTPS and fixes GitHub authority and request path', async () => {
	const { mock } = transport(200, [Buffer.from('{"attestations":[]}')]);
	const hash = 'a'.repeat(64);
	for (const repository of [
		'owner/..',
		'//evil.invalid',
		'owner/repo?x',
		'owner/a%2Fb'
	])
		await expect(fetchGithubAttestations(repository, hash)).rejects.toThrow(
			'Invalid attestation identity'
		);
	await expect(
		fetchGithubAttestations('owner/repo', 'x/'.repeat(32))
	).rejects.toThrow('Invalid attestation identity');
	expect(mock).not.toHaveBeenCalled();
	await expect(fetchGithubAttestations('owner/repo', hash)).resolves.toEqual({
		attestations: []
	});
	expect(mock.mock.calls[0]?.[0]).toMatchObject({
		origin: 'https://api.github.com',
		pathname: '/repos/owner/repo/attestations/sha256:' + hash
	});
	expect(mock.mock.calls[0]?.[1]).toMatchObject({
		method: 'GET',
		lookup: expect.any(Function)
	});
	const endpoint = scopedRpcEndpoint(upstream, upstream)!;
	await expect(
		fetchRpcJson({ ...endpoint, href: 'https://other.example.invalid/' }, {})
	).rejects.toThrow('Unapproved RPC endpoint');
	expect(mock).toHaveBeenCalledTimes(1);
});

it('fails closed before a fifth real transport attempt while preserving the native path', async () => {
	const { observed, mock } = transport(429);
	const scopedApp = express().use(
		'/v1',
		contractProvenanceRouter({
			rpcUrl: native,
			approvedNativeRpcUrl: native,
			provenanceRpcUrl: upstream,
			approvedProvenanceRpcUrl: upstream,
			networkPassphrase: Networks.PUBLIC
		})
	);
	for (let i = 0; i < 5; i++) {
		const id = StrKey.encodeContract(new Uint8Array(32).fill(i));
		const response = await request(scopedApp)
			.get('/v1/contracts/' + id + '/provenance')
			.expect(503);
		expect(response.body.code).toBe('contract_evidence_unavailable');
		expect(response.headers['cache-control']).toBe('no-store');
	}
	expect(mock).toHaveBeenCalledTimes(4);
	expect(observed.map((call) => call.url)).toEqual(Array(4).fill(upstream));

	const nativeApp = express().use(
		'/v1',
		contractProvenanceRouter({
			rpcUrl: native,
			approvedNativeRpcUrl: native,
			networkPassphrase: Networks.PUBLIC
		})
	);
	await request(nativeApp).get(path).expect(503);
	expect(mock).toHaveBeenCalledTimes(5);
	expect(observed[4]?.url).toBe(native);
});

it('rejects a chunked response beyond the configured byte bound and bounds outbound bytes', async () => {
	const { mock } = transport(200, [Buffer.alloc(8192), Buffer.alloc(8193)]);
	const endpoint = scopedRpcEndpoint(upstream, upstream)!;
	const agent = new https.Agent();
	await expect(
		fetchRpcJson(
			endpoint,
			{},
			{
				agent,
				signal: new AbortController().signal,
				maxResponseBytes: 16 * 1024,
				timeoutMs: 2000
			}
		)
	).rejects.toThrow('response exceeds size limit');
	expect(mock.mock.calls[0]?.[1]).toMatchObject({ agent });
	expect(mock).toHaveBeenCalledTimes(1);
	await expect(
		fetchRpcJson(endpoint, { oversized: 'x'.repeat(16 * 1024) })
	).rejects.toThrow('request body exceeds size limit');
	expect(mock).toHaveBeenCalledTimes(1);
});

it.each(['cancelled', 'timed out'])(
	'destroys a hung request when %s with combined options',
	async (reason) => {
		mocks.useFakeTimers();
		const agent = new https.Agent();
		const controller = new AbortController();
		const destroy = mocks.fn();
		const outbound = Object.assign(new EventEmitter(), {
			write: mocks.fn(),
			end: mocks.fn(),
			destroy
		});
		const transport = mocks
			.spyOn(https, 'request')
			.mockReturnValue(outbound as unknown as ReturnType<typeof https.request>);
		try {
			const pending = fetchRpcJson(
				scopedRpcEndpoint(upstream, upstream)!,
				{},
				{
					agent,
					signal: controller.signal,
					maxResponseBytes: 16 * 1024,
					timeoutMs: 30
				}
			);
			expect(transport.mock.calls[0]?.[1]).toMatchObject({ agent });
			const assertion = expect(pending).rejects.toThrow('request ' + reason);
			mocks.advanceTimersByTime(29);
			expect(destroy).not.toHaveBeenCalled();
			if (reason === 'cancelled') controller.abort();
			else mocks.advanceTimersByTime(1);
			await assertion;
			mocks.advanceTimersByTime(30);
			controller.abort();
			expect(destroy).toHaveBeenCalledTimes(1);
		} finally {
			agent.destroy();
			mocks.useRealTimers();
		}
	}
);
