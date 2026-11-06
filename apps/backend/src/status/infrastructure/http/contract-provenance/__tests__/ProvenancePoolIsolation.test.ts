import { EventEmitter } from 'node:events';
import https from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { LookupFunction, Socket } from 'node:net';
import { PassThrough } from 'node:stream';

const { jest: mocks } = import.meta as ImportMeta & { jest: typeof jest };
const privateAddress = '10.23.4.5';
const publicAddress = '93.184.216.34';
const sharedUrl = 'https://pool-isolation.example.invalid/rpc';
let permitGithubPublicAddress = false;

const dnsLookup = mocks.fn(
	(
		host: string,
		options: { all?: boolean },
		callback: (...args: unknown[]) => void
	) => {
		const answer = {
			address:
				host === 'api.github.com' && permitGithubPublicAddress
					? publicAddress
					: privateAddress,
			family: 4
		};
		queueMicrotask(() => {
			if (options.all) callback(null, [answer]);
			else callback(null, answer.address, answer.family);
		});
	}
);

mocks.unstable_mockModule('node:dns', () => ({ lookup: dnsLookup }));

const { nativeRpcEndpoint, scopedRpcEndpoint } =
	await import('../ProvenanceEndpointPolicy.js');
const { fetchGithubAttestations, fetchRpcJson } =
	await import('../BoundedProvenanceJson.js');

type EndpointAgent = https.Agent & {
	options: https.AgentOptions & { lookup?: LookupFunction };
};

type RequestOptionsWithAgent = RequestOptions & { agent?: EndpointAgent };

interface TransportObservation {
	host: string;
	agent: EndpointAgent;
	name: string;
	pooledAtStart: Socket | undefined;
}

function makeFreeSocket(): Socket {
	return Object.assign(new EventEmitter(), {
		destroyed: false,
		destroy() {
			this.destroyed = true;
		}
	}) as unknown as Socket;
}

function makeQueuedRequest(): ClientRequest {
	return Object.assign(new EventEmitter(), {
		destroy: () => undefined
	}) as unknown as ClientRequest;
}

function installOfflineHttpsTransport() {
	const observations: TransportObservation[] = [];
	const createdSockets: Socket[] = [];
	const deniedHosts: string[] = [];
	const nativeSocket = makeFreeSocket();

	const request = mocks.spyOn(https, 'request').mockImplementation(((
		destination: URL,
		requestOptions: RequestOptionsWithAgent,
		handleResponse: (response: IncomingMessage) => void
	) => {
		const agent = requestOptions.agent;
		if (!agent) throw new Error('Expected a dedicated HTTPS agent');
		const host = destination.hostname;
		const name = agent.getName({
			host,
			port: destination.port || '443',
			servername: host
		});
		const pooledAtStart = agent.freeSockets[name]?.[0];
		observations.push({ host, agent, name, pooledAtStart });

		const outbound = new EventEmitter() as EventEmitter & {
			write: (payload: string | Buffer) => boolean;
			end: () => void;
			destroy: () => void;
		};
		outbound.write = () => true;
		outbound.destroy = () => undefined;
		outbound.end = () => {
			const respond = (body: string) => {
				queueMicrotask(() => {
					const incoming = Object.assign(new PassThrough(), {
						statusCode: 200,
						headers: { 'content-type': 'application/json' }
					});
					handleResponse(incoming as IncomingMessage);
					incoming.end(body);
				});
			};

			if (pooledAtStart) {
				respond(
					destination.pathname.includes('/attestations/')
						? '{"attestations":[]}'
						: '{"ok":true}'
				);
				return;
			}

			const lookup = agent.options.lookup ?? requestOptions.lookup;
			if (!lookup) throw new Error('Endpoint agent lacks its checked lookup');
			lookup(host, { family: 0 }, (error) => {
				if (error) {
					deniedHosts.push(host);
					queueMicrotask(() => outbound.emit('error', error));
					return;
				}
				const socket =
					host === 'pool-isolation.example.invalid'
						? nativeSocket
						: makeFreeSocket();
				createdSockets.push(socket);
				agent.freeSockets[name] = [socket];
				respond(
					destination.pathname.includes('/attestations/')
						? '{"attestations":[]}'
						: '{"ok":true}'
				);
			});
		};
		return outbound as unknown as ReturnType<typeof https.request>;
	}) as typeof https.request);

	return { request, observations, createdSockets, deniedHosts, nativeSocket };
}

afterEach(() => {
	permitGithubPublicAddress = false;
	mocks.restoreAllMocks();
});

it('isolates same-authority endpoint pools and rejects private scoped DNS without opening a socket', async () => {
	const transport = installOfflineHttpsTransport();
	const native = nativeRpcEndpoint(sharedUrl, sharedUrl, privateAddress);
	const scoped = scopedRpcEndpoint(sharedUrl, sharedUrl);
	expect(native).toBeDefined();
	expect(scoped).toBeDefined();

	await expect(
		fetchRpcJson(native!, { jsonrpc: '2.0', id: 1, method: 'native-first' })
	).resolves.toEqual({ ok: true });
	await expect(
		fetchRpcJson(native!, { jsonrpc: '2.0', id: 2, method: 'native-reuse' })
	).resolves.toEqual({ ok: true });

	const nativeAgent = transport.observations[0]!.agent;
	const key = transport.observations[0]!.name;
	expect(transport.observations[1]!.agent).toBe(nativeAgent);
	expect(transport.observations[1]!.pooledAtStart).toBe(transport.nativeSocket);
	expect(nativeAgent.freeSockets[key]).toEqual([transport.nativeSocket]);
	const queued = makeQueuedRequest();
	nativeAgent.requests[key] = [queued];

	await expect(
		fetchRpcJson(scoped!, { jsonrpc: '2.0', id: 1, method: 'scoped-denied' })
	).rejects.toThrow();
	const scopedObservation = transport.observations[2]!;
	expect(scopedObservation.host).toBe('pool-isolation.example.invalid');
	expect(scopedObservation.name).toBe(key);
	expect(scopedObservation.agent).not.toBe(nativeAgent);
	expect(scopedObservation.pooledAtStart).toBeUndefined();
	expect(scopedObservation.agent.requests[key]).toBeUndefined();
	expect(transport.deniedHosts).toEqual(['pool-isolation.example.invalid']);
	expect(transport.createdSockets).toHaveLength(1);
	expect(nativeAgent.freeSockets[key]).toEqual([transport.nativeSocket]);
});

it('keeps the fixed GitHub agent isolated from a native endpoint pool', async () => {
	const transport = installOfflineHttpsTransport();
	const sameAuthorityUrl = 'https://api.github.com/rpc';
	const native = nativeRpcEndpoint(
		sameAuthorityUrl,
		sameAuthorityUrl,
		privateAddress
	)!;
	await expect(
		fetchRpcJson(native, { jsonrpc: '2.0', id: 1, method: 'native' })
	).resolves.toEqual({ ok: true });

	const nativeObservation = transport.observations[0]!;
	const queued = makeQueuedRequest();
	nativeObservation.agent.requests[nativeObservation.name] = [queued];
	await expect(
		fetchGithubAttestations('owner/repo', 'a'.repeat(64))
	).rejects.toThrow();
	const githubObservation = transport.observations[1]!;
	expect(githubObservation.host).toBe('api.github.com');
	expect(githubObservation.name).toBe(nativeObservation.name);
	expect(githubObservation.agent).not.toBe(nativeObservation.agent);
	expect(githubObservation.pooledAtStart).toBeUndefined();
	expect(
		githubObservation.agent.requests[nativeObservation.name]
	).toBeUndefined();
	expect(transport.deniedHosts).toEqual(['api.github.com']);
	expect(transport.createdSockets).toHaveLength(1);

	permitGithubPublicAddress = true;
	await expect(
		fetchGithubAttestations('owner/repo', 'a'.repeat(64))
	).resolves.toEqual({ attestations: [] });
	expect(transport.observations[2]!.agent).toBe(githubObservation.agent);
	expect(transport.observations[2]!.pooledAtStart).toBeUndefined();
	expect(transport.createdSockets).toHaveLength(2);
});
