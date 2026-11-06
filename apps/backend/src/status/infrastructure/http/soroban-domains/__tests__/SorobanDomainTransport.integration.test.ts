import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import { readContractCode } from '../../contract-provenance/ContractRpcCode.js';
import { nativeRpcEndpoint } from '../../contract-provenance/ProvenanceEndpointPolicy.js';
import { exactDomainName } from '../SorobanDomainRecord.js';
import {
	SorobanDomainBusy,
	SorobanDomainResolver
} from '../SorobanDomainResolver.js';
import { sorobanDomainRouter } from '../SorobanDomainRouter.js';

const servers: Server[] = [];

async function listen(server: Server): Promise<URL> {
	servers.push(server);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Expected a test listener');
	return new URL(`http://127.0.0.1:${address.port}`);
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				})
		)
	);
});

function reply(response: ServerResponse, result: object): void {
	response.setHeader('Content-Type', 'application/json');
	response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
}

function upstream(
	handle: (method: string, response: ServerResponse) => void
): Promise<URL> {
	return listen(
		createServer((request, response) => {
			let body = '';
			request.setEncoding('utf8');
			request.on('data', (chunk: string) => {
				body += chunk;
			});
			request.on('end', () =>
				handle((JSON.parse(body) as { method: string }).method, response)
			);
		})
	);
}

test('two stalled cold lookups leave contract verification capacity and release their sockets at deadline', async () => {
	const stalled: ServerResponse[] = [];
	const entered = Promise.withResolvers<void>();
	const closed = Promise.withResolvers<void>();
	let closedCount = 0;
	let recover = false;
	const url = await upstream((method, response) => {
		if (method === 'getLedgerEntries') {
			reply(response, { latestLedger: 123, entries: [] });
		} else if (method === 'getNetwork' && recover) {
			reply(response, { passphrase: Networks.TESTNET });
		} else {
			stalled.push(response);
			response.once('close', () => {
				if (++closedCount === 2) closed.resolve();
			});
			if (stalled.length === 2) entered.resolve();
		}
	});
	const endpoint = nativeRpcEndpoint(url.href, url.href)!;
	const resolver = new SorobanDomainResolver(endpoint, 1_200);
	const first = exactDomainName('first.xlm')!;
	const second = exactDomainName('second.xlm')!;
	const domains = Promise.allSettled([
		resolver.resolve(first),
		resolver.resolve(second)
	]);
	await entered.promise;
	await expect(
		resolver.resolve(exactDomainName('third.xlm')!)
	).rejects.toBeInstanceOf(SorobanDomainBusy);
	await expect(
		readContractCode(endpoint, StrKey.encodeContract(Buffer.alloc(32, 8)))
	).resolves.toMatchObject({ ledger: 123, executable: 'not_found' });
	expect(stalled.every((response) => !response.destroyed)).toBe(true);
	const outcomes = await domains;
	expect(outcomes).toEqual([
		{
			status: 'rejected',
			reason: expect.objectContaining({
				message: 'Provenance request cancelled'
			})
		},
		{
			status: 'rejected',
			reason: expect.objectContaining({
				message: 'Provenance request cancelled'
			})
		}
	]);
	await closed.promise;
	recover = true;
	await expect(resolver.resolve(first)).rejects.toThrow(
		'Registry RPC network mismatch'
	);
});

test('aborting the HTTP caller closes the in-flight outbound RPC when no callers remain', async () => {
	const entered = Promise.withResolvers<void>();
	const closed = Promise.withResolvers<void>();
	const methods: string[] = [];
	const rpc = await upstream((method, response) => {
		methods.push(method);
		response.once('close', () => closed.resolve());
		entered.resolve();
	});
	const api = await listen(
		createServer(
			express().use(
				'/v1',
				sorobanDomainRouter({
					networkPassphrase: Networks.PUBLIC,
					rpcUrl: rpc.href,
					approvedNativeRpcUrl: rpc.href
				})
			)
		)
	);
	const controller = new AbortController();
	const pending = expect(
		fetch(new URL('/v1/soroban-domains/mate.xlm', api), {
			signal: controller.signal
		})
	).rejects.toMatchObject({ name: 'AbortError' });
	await entered.promise;
	controller.abort();
	await pending;
	await closed.promise;
	expect(methods).toEqual(['getNetwork']);
});
