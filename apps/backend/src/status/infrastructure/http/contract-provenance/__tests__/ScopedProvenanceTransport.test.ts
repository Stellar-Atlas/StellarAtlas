import { Networks, StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { contractProvenanceRouter } from '../ContractProvenanceRouter.js';
import { fetchProvenanceJson } from '../BoundedProvenanceJson.js';

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

afterEach(() => mocks.restoreAllMocks());

it.each([302, 429])(
	'does not redirect, retry or fall back after HTTPS %i',
	async (statusCode) => {
		const { observed, mock } = transport(statusCode);
		const app = express().use(
			'/v1',
			contractProvenanceRouter({
				rpcUrl: native,
				provenanceRpcUrl: upstream,
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
			provenanceRpcUrl: '',
			networkPassphrase: Networks.PUBLIC
		})
	);
	await request(app).get(path).expect(503);
	expect(mock).not.toHaveBeenCalled();
});

it('rejects a chunked response beyond the configured byte bound and bounds outbound bytes', async () => {
	const { mock } = transport(200, [Buffer.alloc(8192), Buffer.alloc(8193)]);
	const url = new URL(upstream);
	await expect(
		fetchProvenanceJson(
			url,
			{},
			{ maxResponseBytes: 16 * 1024, timeoutMs: 2000 }
		)
	).rejects.toThrow('response exceeds size limit');
	expect(mock).toHaveBeenCalledTimes(1);
	await expect(
		fetchProvenanceJson(url, { oversized: 'x'.repeat(16 * 1024) })
	).rejects.toThrow('request body exceeds size limit');
	expect(mock).toHaveBeenCalledTimes(1);
});

it('destroys a hung request when the remaining deadline expires', async () => {
	mocks.useFakeTimers();
	const destroy = mocks.fn();
	const outbound = Object.assign(new EventEmitter(), {
		write: mocks.fn(),
		end: mocks.fn(),
		destroy
	});
	mocks
		.spyOn(https, 'request')
		.mockReturnValue(outbound as unknown as ReturnType<typeof https.request>);
	try {
		const pending = fetchProvenanceJson(
			new URL(upstream),
			{},
			{
				maxResponseBytes: 16 * 1024,
				timeoutMs: 30
			}
		);
		const assertion = expect(pending).rejects.toThrow('request timed out');
		mocks.advanceTimersByTime(29);
		expect(destroy).not.toHaveBeenCalled();
		mocks.advanceTimersByTime(1);
		await assertion;
		expect(destroy).toHaveBeenCalledTimes(1);
	} finally {
		mocks.useRealTimers();
	}
});
