import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { ClientRequest } from 'node:http';
import { githubRepository } from './ContractBuildAttestation.js';
import {
	isRpcEndpoint,
	publicEndpointLookup,
	type RpcEndpoint
} from './ProvenanceEndpointPolicy.js';

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const httpAgent = new http.Agent({
	keepAlive: true,
	maxSockets: 2,
	maxTotalSockets: 2,
	maxFreeSockets: 1
});

const httpsAgent = new https.Agent({
	keepAlive: true,
	maxSockets: 2,
	maxTotalSockets: 2,
	maxFreeSockets: 1
});

export type ProvenanceJsonErrorKind = 'http' | 'transport' | 'invalid_response';

export class ProvenanceHttpError extends Error {
	readonly status: number | null;
	readonly kind: ProvenanceJsonErrorKind;

	constructor(
		status: number | null,
		kind: ProvenanceJsonErrorKind,
		message: string
	) {
		super(message);
		this.name = 'ProvenanceHttpError';
		this.status = status;
		this.kind = kind;
	}
}

function isJsonContentType(value: string | undefined): boolean {
	if (value === undefined) return false;
	const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
	return (
		mediaType === 'application/json' || (mediaType?.endsWith('+json') ?? false)
	);
}

function bodyBytes(body: unknown): Buffer | undefined {
	if (body === undefined) return undefined;
	let serialized: string;
	try {
		serialized = JSON.stringify(body);
	} catch {
		throw new ProvenanceHttpError(
			null,
			'invalid_response',
			'Invalid provenance request body'
		);
	}
	if (serialized === undefined) {
		throw new ProvenanceHttpError(
			null,
			'invalid_response',
			'Invalid provenance request body'
		);
	}
	const bytes = Buffer.from(serialized, 'utf8');
	if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
		throw new ProvenanceHttpError(
			null,
			'invalid_response',
			'Provenance request body exceeds size limit'
		);
	}
	return bytes;
}

type RequestLimits = {
	readonly agent?: http.Agent;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
};

export async function fetchRpcJson(
	endpoint: RpcEndpoint,
	body: object,
	options: RequestLimits = {}
): Promise<unknown> {
	if (!isRpcEndpoint(endpoint))
		throw new ProvenanceHttpError(null, 'transport', 'Unapproved RPC endpoint');
	return requestJson(new URL(endpoint.href), endpoint.lookup, body, options);
}

const githubLookup = publicEndpointLookup('api.github.com');

export async function fetchGithubAttestations(
	repository: string,
	digest: string
): Promise<unknown> {
	const name = githubRepository('github:' + repository);
	if (!name || !/^[0-9a-f]{64}$/.test(digest))
		throw new ProvenanceHttpError(
			null,
			'transport',
			'Invalid attestation identity'
		);
	const destination = new URL('https://api.github.com');
	destination.pathname = '/repos/' + name + '/attestations/sha256:' + digest;
	destination.search = 'per_page=5';
	return requestJson(destination, githubLookup);
}

async function requestJson(
	url: URL,
	lookup: RpcEndpoint['lookup'],
	body?: unknown,
	options: RequestLimits = {}
): Promise<unknown> {
	const { agent, signal } = options;
	signal?.throwIfAborted();
	const payload = bodyBytes(body);
	const timeoutMs = Math.min(
		options.timeoutMs ?? REQUEST_TIMEOUT_MS,
		REQUEST_TIMEOUT_MS
	);
	const maxResponseBytes = Math.min(
		options.maxResponseBytes ?? MAX_RESPONSE_BYTES,
		MAX_RESPONSE_BYTES
	);
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.hostname.length === 0 ||
		url.username.length > 0 ||
		url.password.length > 0
	) {
		throw new ProvenanceHttpError(
			null,
			'transport',
			'Invalid provenance request destination'
		);
	}

	const headers: Record<string, string> = {
		Accept: 'application/json',
		'User-Agent': 'StellarAtlas'
	};
	if (url.hostname.toLowerCase() === 'api.github.com')
		headers['X-GitHub-Api-Version'] = '2022-11-28';
	if (payload !== undefined) {
		headers['Content-Type'] = 'application/json';
		headers['Content-Length'] = String(payload.byteLength);
	}

	return await new Promise<unknown>((resolve, reject) => {
		let response: IncomingMessage | undefined;
		let request: ClientRequest | undefined;
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const finish = (error?: ProvenanceHttpError, value?: unknown): void => {
			if (settled) return;
			settled = true;
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener('abort', onAbort);
			if (error !== undefined) {
				response?.destroy();
				request?.destroy();
				reject(error);
			} else {
				resolve(value);
			}
		};

		const onAbort = (): void =>
			finish(
				new ProvenanceHttpError(
					null,
					'transport',
					'Provenance request cancelled'
				)
			);
		signal?.addEventListener('abort', onAbort, { once: true });

		const requestOptions: RequestOptions = {
			method: payload === undefined ? 'GET' : 'POST',
			headers,
			lookup
		};

		timeout = setTimeout(() => {
			finish(
				new ProvenanceHttpError(
					null,
					'transport',
					'Provenance request timed out'
				)
			);
		}, timeoutMs);

		try {
			const handleResponse = (incoming: IncomingMessage): void => {
				response = incoming;
				const status = incoming.statusCode;
				if (status !== 200) {
					finish(
						new ProvenanceHttpError(
							typeof status === 'number' ? status : null,
							typeof status === 'number' ? 'http' : 'transport',
							typeof status === 'number'
								? 'Provenance request returned a non-success status'
								: 'Provenance response had no status'
						)
					);
					return;
				}
				if (!isJsonContentType(incoming.headers['content-type'])) {
					finish(
						new ProvenanceHttpError(
							null,
							'invalid_response',
							'Provenance response was not JSON'
						)
					);
					return;
				}

				const contentLength = incoming.headers['content-length'];
				if (
					contentLength !== undefined &&
					/^\d+$/.test(contentLength) &&
					Number(contentLength) > maxResponseBytes
				) {
					finish(
						new ProvenanceHttpError(
							null,
							'invalid_response',
							'Provenance response exceeds size limit'
						)
					);
					return;
				}

				const chunks: Buffer[] = [];
				let receivedBytes = 0;
				incoming.on('data', (chunk: Buffer | string) => {
					if (settled) return;
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					receivedBytes += buffer.byteLength;
					if (receivedBytes > maxResponseBytes) {
						finish(
							new ProvenanceHttpError(
								null,
								'invalid_response',
								'Provenance response exceeds size limit'
							)
						);
						return;
					}
					chunks.push(buffer);
				});
				incoming.once('aborted', () =>
					finish(
						new ProvenanceHttpError(
							null,
							'transport',
							'Provenance response was interrupted'
						)
					)
				);
				incoming.once('error', () =>
					finish(
						new ProvenanceHttpError(
							null,
							'transport',
							'Provenance response failed'
						)
					)
				);
				incoming.once('end', () => {
					if (settled) return;
					try {
						const parsed: unknown = JSON.parse(
							Buffer.concat(chunks, receivedBytes).toString('utf8')
						);
						finish(undefined, parsed);
					} catch {
						finish(
							new ProvenanceHttpError(
								null,
								'invalid_response',
								'Provenance response contained invalid JSON'
							)
						);
					}
				});
			};
			request =
				url.protocol === 'https:'
					? https.request(
							url,
							{ ...requestOptions, agent: agent ?? httpsAgent },
							handleResponse
						)
					: http.request(
							url,
							{ ...requestOptions, agent: agent ?? httpAgent },
							handleResponse
						);
			request.once('error', () =>
				finish(
					new ProvenanceHttpError(
						null,
						'transport',
						'Provenance request failed'
					)
				)
			);
			if (payload !== undefined) request.write(payload);
			request.end();
		} catch {
			finish(
				new ProvenanceHttpError(null, 'transport', 'Provenance request failed')
			);
		}
	});
}
