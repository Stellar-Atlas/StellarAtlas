import { createHash } from 'node:crypto';
import type {
	FullHistoryLedgerCloseMetaSourceDescriptor,
	FullHistoryLedgerCloseMetaSourceObject,
	FullHistoryLedgerCloseMetaSourceReadResult
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import type { FullHistoryLedgerCloseMetaSourcePort } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import type { IngressByteRateLimiter } from './AggregateIngressByteRateLimiter.js';
import { createSep54LedgerCloseMetaConfigObjectKey } from './Sep54LedgerCloseMetaObjectKey.js';

export type AnonymousHttpSep54Fetch = (
	input: string | URL,
	init?: RequestInit
) => Promise<Response>;

export interface AnonymousHttpSep54LedgerCloseMetaSourceOptions {
	readonly baseUrl: string;
	readonly fetchFn?: AnonymousHttpSep54Fetch;
	readonly ingressLimiter: IngressByteRateLimiter;
	readonly ledgersPath: string;
	readonly maximumResponseBytes: number;
	readonly requestTimeoutMilliseconds: number;
}

export type AnonymousHttpSep54SourceFailureReason =
	| 'aborted'
	| 'http-status'
	| 'invalid-configuration'
	| 'invalid-object-key'
	| 'invalid-response-metadata'
	| 'network-failure'
	| 'not-found'
	| 'request-timeout'
	| 'response-body-missing'
	| 'response-byte-limit-exceeded';

interface AnonymousHttpSep54SourceErrorContext {
	readonly cause?: unknown;
	readonly objectKey?: string;
	readonly status?: number;
}

export class AnonymousHttpSep54SourceError extends Error {
	readonly objectKey?: string;
	readonly reason: AnonymousHttpSep54SourceFailureReason;
	readonly status?: number;

	constructor(
		reason: AnonymousHttpSep54SourceFailureReason,
		message: string,
		context: AnonymousHttpSep54SourceErrorContext = {}
	) {
		super(
			message,
			context.cause === undefined ? undefined : { cause: context.cause }
		);
		this.name = 'AnonymousHttpSep54SourceError';
		this.reason = reason;
		this.objectKey = context.objectKey;
		this.status = context.status;
	}
}

export class AnonymousHttpSep54LedgerCloseMetaSource implements FullHistoryLedgerCloseMetaSourcePort {
	readonly #baseUrl: URL;
	readonly #descriptor: FullHistoryLedgerCloseMetaSourceDescriptor;
	readonly #fetchFn: AnonymousHttpSep54Fetch;
	readonly #ingressLimiter: IngressByteRateLimiter;
	readonly #maximumResponseBytes: number;
	readonly #requestTimeoutMilliseconds: number;

	constructor(options: AnonymousHttpSep54LedgerCloseMetaSourceOptions) {
		this.#baseUrl = parseBaseUrl(options.baseUrl);
		const configObjectKey = createSep54LedgerCloseMetaConfigObjectKey(
			options.ledgersPath
		);
		const ledgersPath = configObjectKey.endsWith('/.config.json')
			? configObjectKey.slice(0, -'/.config.json'.length)
			: '';
		assertPositiveSafeInteger(
			options.maximumResponseBytes,
			'maximumResponseBytes'
		);
		assertPositiveSafeInteger(
			options.requestTimeoutMilliseconds,
			'requestTimeoutMilliseconds'
		);

		this.#descriptor = Object.freeze({
			ledgersPath,
			sourceUri: this.#baseUrl.href.replace(/\/$/, '')
		});
		this.#fetchFn = options.fetchFn ?? fetch;
		this.#ingressLimiter = options.ingressLimiter;
		this.#maximumResponseBytes = options.maximumResponseBytes;
		this.#requestTimeoutMilliseconds = options.requestTimeoutMilliseconds;
	}

	source(): FullHistoryLedgerCloseMetaSourceDescriptor {
		return this.#descriptor;
	}

	async readConfig(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceObject> {
		const objectKey = createSep54LedgerCloseMetaConfigObjectKey(
			this.#descriptor.ledgersPath
		);
		const result = await this.#readObject(objectKey, signal);
		if (result.status === 'not-found') {
			throw new AnonymousHttpSep54SourceError(
				'not-found',
				'SEP-54 source config was not found',
				{ objectKey, status: 404 }
			);
		}
		return result.object;
	}

	readBatch(
		objectKey: string,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceReadResult> {
		assertBatchObjectKey(objectKey, this.#descriptor.ledgersPath);
		return this.#readObject(objectKey, signal);
	}

	async #readObject(
		objectKey: string,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceReadResult> {
		if (signal.aborted) {
			throw fetchFailure(signal.reason, objectKey, signal);
		}
		const objectUrl = objectUrlFor(this.#baseUrl, objectKey);
		const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMilliseconds);
		const requestSignal = AbortSignal.any([signal, timeoutSignal]);
		let response: Response;
		try {
			response = await this.#fetchFn(objectUrl, {
				cache: 'no-store',
				credentials: 'omit',
				headers: { accept: 'application/octet-stream' },
				redirect: 'manual',
				signal: requestSignal
			});
		} catch (error) {
			throw fetchFailure(error, objectKey, signal, timeoutSignal);
		}

		if (response.status === 404) {
			await response.body?.cancel().catch(() => undefined);
			return { status: 'not-found' };
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			throw new AnonymousHttpSep54SourceError(
				'http-status',
				`SEP-54 source returned HTTP ${response.status}`,
				{ objectKey, status: response.status }
			);
		}

		try {
			const bytes = await readBoundedBytes(
				response,
				this.#maximumResponseBytes,
				this.#ingressLimiter,
				requestSignal,
				objectKey
			);
			return {
				object: {
					bytes,
					identity: responseIdentity(response, objectKey, objectUrl, bytes)
				},
				status: 'found'
			};
		} catch (error) {
			await response.body?.cancel().catch(() => undefined);
			if (error instanceof AnonymousHttpSep54SourceError) throw error;
			throw fetchFailure(error, objectKey, signal, timeoutSignal);
		}
	}
}

async function readBoundedBytes(
	response: Response,
	maximumBytes: number,
	limiter: IngressByteRateLimiter,
	signal: AbortSignal,
	objectKey: string
): Promise<Uint8Array> {
	const contentLength = parseContentLength(response.headers, objectKey);
	if (contentLength !== null && contentLength > maximumBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw byteLimitError(maximumBytes, objectKey);
	}
	if (!response.body) {
		throw new AnonymousHttpSep54SourceError(
			'response-body-missing',
			'SEP-54 source returned a successful response without a body',
			{ objectKey, status: response.status }
		);
	}

	const chunks: Uint8Array[] = [];
	const reader = response.body.getReader();
	let byteCount = 0;
	let completed = false;
	try {
		while (true) {
			signal.throwIfAborted();
			const next = await reader.read();
			if (next.done) {
				completed = true;
				break;
			}
			await limiter.throttle(next.value.byteLength, signal);
			byteCount += next.value.byteLength;
			if (!Number.isSafeInteger(byteCount) || byteCount > maximumBytes) {
				throw byteLimitError(maximumBytes, objectKey);
			}
			if (next.value.byteLength > 0) chunks.push(next.value.slice());
		}
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}

	const bytes = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function responseIdentity(
	response: Response,
	objectKey: string,
	objectUrl: URL,
	bytes: Uint8Array
): FullHistoryLedgerCloseMetaSourceObject['identity'] {
	const etag = safeOpaqueHeader(response.headers, 'etag');
	const providerGeneration =
		safeOpaqueHeader(response.headers, 'x-goog-generation') ??
		safeOpaqueHeader(response.headers, 'x-amz-version-id');
	const lastModified = safeLastModified(response.headers);
	const identityParts = [
		identityPart('provider-generation', providerGeneration),
		identityPart('etag', etag),
		identityPart('last-modified', lastModified)
	].filter((part): part is string => part !== null);
	const generation =
		identityParts.length > 0
			? `http-v1;${identityParts.join(';')}`
			: `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

	return Object.freeze({
		...(etag === undefined ? {} : { etag }),
		generation,
		objectKey,
		sourceUri: objectUrl.href
	});
}

function parseBaseUrl(value: string): URL {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2_048) {
		throw configurationError('baseUrl must be a bounded HTTPS URL');
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw configurationError('baseUrl must be a valid HTTPS URL', error);
	}
	if (
		url.protocol !== 'https:' ||
		url.username.length > 0 ||
		url.password.length > 0 ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		throw configurationError(
			'baseUrl must use HTTPS without credentials, query, or fragment'
		);
	}
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
	return url;
}

function objectUrlFor(baseUrl: URL, objectKey: string): URL {
	assertSafeObjectKey(objectKey);
	return new URL(objectKey, baseUrl);
}

function assertBatchObjectKey(objectKey: string, ledgersPath: string): void {
	assertSafeObjectKey(objectKey);
	if (!objectKey.endsWith('.xdr.zst')) {
		throw objectKeyError('Batch object keys must end in .xdr.zst');
	}
	if (ledgersPath.length > 0 && !objectKey.startsWith(`${ledgersPath}/`)) {
		throw objectKeyError(
			'Batch object key is outside the configured ledgers path'
		);
	}
}

function assertSafeObjectKey(objectKey: string): void {
	if (
		typeof objectKey !== 'string' ||
		objectKey.length === 0 ||
		Buffer.byteLength(objectKey, 'utf8') > 4_096 ||
		objectKey.startsWith('/')
	) {
		throw objectKeyError('Object key must be a bounded relative path');
	}
	const segments = objectKey.split('/');
	if (
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment === '.' ||
				segment === '..' ||
				!/^[A-Za-z0-9._-]+$/.test(segment)
		)
	) {
		throw objectKeyError('Object key contains an unsafe path segment');
	}
}

function parseContentLength(
	headers: Headers,
	objectKey: string
): number | null {
	const value = headers.get('content-length');
	if (value === null) return null;
	if (!/^(0|[1-9][0-9]*)$/.test(value)) {
		throw responseMetadataError('Invalid Content-Length header', objectKey);
	}
	const contentLength = Number(value);
	if (!Number.isSafeInteger(contentLength)) {
		throw responseMetadataError('Content-Length exceeds safe range', objectKey);
	}
	return contentLength;
}

function safeOpaqueHeader(headers: Headers, name: string): string | undefined {
	const value = headers.get(name)?.trim();
	if (
		value === undefined ||
		value.length === 0 ||
		Buffer.byteLength(value, 'utf8') > 512 ||
		hasControlCharacter(value)
	) {
		return undefined;
	}
	return value;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
			return true;
		}
	}
	return false;
}

function safeLastModified(headers: Headers): string | undefined {
	const value = safeOpaqueHeader(headers, 'last-modified');
	if (value === undefined) return undefined;
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds)
		? new Date(milliseconds).toISOString()
		: undefined;
}

function identityPart(label: string, value: string | undefined): string | null {
	return value === undefined
		? null
		: `${label}=${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function fetchFailure(
	error: unknown,
	objectKey: string,
	callerSignal: AbortSignal,
	timeoutSignal?: AbortSignal
): AnonymousHttpSep54SourceError {
	if (callerSignal.aborted) {
		return new AnonymousHttpSep54SourceError(
			'aborted',
			'SEP-54 source request was aborted',
			{ cause: error, objectKey }
		);
	}
	if (timeoutSignal?.aborted) {
		return new AnonymousHttpSep54SourceError(
			'request-timeout',
			'SEP-54 source request exceeded its deadline',
			{ cause: error, objectKey }
		);
	}
	if (isAbortError(error)) {
		return new AnonymousHttpSep54SourceError(
			'aborted',
			'SEP-54 source request was aborted',
			{ cause: error, objectKey }
		);
	}
	return new AnonymousHttpSep54SourceError(
		'network-failure',
		'SEP-54 source request failed',
		{ cause: error, objectKey }
	);
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error.name === 'AbortError' || error.name === 'TimeoutError')
	);
}

function byteLimitError(
	maximumBytes: number,
	objectKey: string
): AnonymousHttpSep54SourceError {
	return new AnonymousHttpSep54SourceError(
		'response-byte-limit-exceeded',
		`SEP-54 response exceeded ${maximumBytes} bytes`,
		{ objectKey }
	);
}

function configurationError(
	message: string,
	cause?: unknown
): AnonymousHttpSep54SourceError {
	return new AnonymousHttpSep54SourceError(
		'invalid-configuration',
		message,
		cause === undefined ? undefined : { cause }
	);
}

function objectKeyError(message: string): AnonymousHttpSep54SourceError {
	return new AnonymousHttpSep54SourceError('invalid-object-key', message);
}

function responseMetadataError(
	message: string,
	objectKey: string
): AnonymousHttpSep54SourceError {
	return new AnonymousHttpSep54SourceError(
		'invalid-response-metadata',
		message,
		{ objectKey }
	);
}

function assertPositiveSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw configurationError(`${field} must be a positive safe integer`);
	}
}
