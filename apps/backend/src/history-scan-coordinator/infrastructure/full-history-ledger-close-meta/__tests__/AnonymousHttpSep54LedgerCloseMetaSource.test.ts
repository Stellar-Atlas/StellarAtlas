import { createHash } from 'node:crypto';
import type { IngressByteRateLimiter } from '../AggregateIngressByteRateLimiter.js';
import {
	AnonymousHttpSep54LedgerCloseMetaSource,
	AnonymousHttpSep54SourceError,
	type AnonymousHttpSep54Fetch,
	type AnonymousHttpSep54SourceFailureReason
} from '../AnonymousHttpSep54LedgerCloseMetaSource.js';

const baseUrl = 'https://objects.example.test/archive-root';
const ledgersPath = 'v1.1/stellar/ledgers/pubnet';
const batchObjectKey = `${ledgersPath}/FFFFFFFC--3.xdr.zst`;

describe('AnonymousHttpSep54LedgerCloseMetaSource', () => {
	it('reads config anonymously from its fixed HTTPS path and captures identity', async () => {
		const limiter = new RecordingIngressLimiter();
		let observed: { init?: RequestInit; url: string } | undefined;
		const fetchFn: AnonymousHttpSep54Fetch = async (input, init) => {
			observed = { init, url: input.toString() };
			return chunkedResponse([Buffer.from('ab'), Buffer.from('cde')], {
				etag: '"config-etag"',
				'last-modified': 'Tue, 14 Jul 2026 00:00:00 GMT',
				'x-amz-version-id': 'version-7'
			});
		};
		const source = createSource(fetchFn, limiter);
		const signal = new AbortController().signal;

		const object = await source.readConfig(signal);

		expect(source.source()).toEqual({
			ledgersPath,
			sourceUri: baseUrl
		});
		expect(observed?.url).toBe(`${baseUrl}/${ledgersPath}/.config.json`);
		expect(observed?.init).toMatchObject({
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'manual'
		});
		expect(observed?.init?.signal).toBeInstanceOf(AbortSignal);
		expect(object.bytes).toEqual(Buffer.from('abcde'));
		expect(object.identity).toMatchObject({
			etag: '"config-etag"',
			objectKey: `${ledgersPath}/.config.json`,
			sourceUri: `${baseUrl}/${ledgersPath}/.config.json`
		});
		expect(object.identity.generation).toContain('provider-generation=');
		expect(object.identity.generation).toContain('etag=');
		expect(object.identity.generation).toContain('last-modified=');
		expect(limiter.byteCounts).toEqual([2, 3]);
		expect(limiter.signals).toHaveLength(2);
		expect(limiter.signals.every((value) => !value.aborted)).toBe(true);
	});

	it('returns not-found for a missing batch without retrying', async () => {
		const limiter = new RecordingIngressLimiter();
		let requestCount = 0;
		const fetchFn: AnonymousHttpSep54Fetch = async () => {
			requestCount += 1;
			return new Response(null, { status: 404 });
		};
		const source = createSource(fetchFn, limiter);

		await expect(
			source.readBatch(batchObjectKey, new AbortController().signal)
		).resolves.toEqual({ status: 'not-found' });
		expect(requestCount).toBe(1);
		expect(limiter.byteCounts).toEqual([]);
	});

	it('maps missing config to a typed not-found infrastructure failure', async () => {
		const source = createSource(
			async () => new Response(null, { status: 404 }),
			new RecordingIngressLimiter()
		);

		await expectSourceError(
			() => source.readConfig(new AbortController().signal),
			'not-found',
			404
		);
	});

	it('maps non-2xx responses to one typed failure without hidden retries', async () => {
		let requestCount = 0;
		const source = createSource(async () => {
			requestCount += 1;
			return new Response('unavailable', { status: 503 });
		}, new RecordingIngressLimiter());

		await expectSourceError(
			() => source.readBatch(batchObjectKey, new AbortController().signal),
			'http-status',
			503
		);
		expect(requestCount).toBe(1);
	});

	it('enforces Content-Length before consuming an oversized response', async () => {
		const limiter = new RecordingIngressLimiter();
		const source = createSource(
			async () =>
				new Response('123456', {
					headers: { 'content-length': '6' }
				}),
			limiter,
			5
		);

		await expectSourceError(
			() => source.readBatch(batchObjectKey, new AbortController().signal),
			'response-byte-limit-exceeded'
		);
		expect(limiter.byteCounts).toEqual([]);
	});

	it('charges streamed chunks to the shared limiter and stops at the byte limit', async () => {
		const limiter = new RecordingIngressLimiter();
		const source = createSource(
			async () => chunkedResponse([Buffer.from('123'), Buffer.from('456')]),
			limiter,
			5
		);

		await expectSourceError(
			() => source.readBatch(batchObjectKey, new AbortController().signal),
			'response-byte-limit-exceeded'
		);
		expect(limiter.byteCounts).toEqual([3, 3]);
	});

	it('uses a content digest when the source supplies no object identity headers', async () => {
		const payload = Buffer.from('ledger-close-meta');
		const source = createSource(
			async () => new Response(payload),
			new RecordingIngressLimiter()
		);

		const result = await source.readBatch(
			batchObjectKey,
			new AbortController().signal
		);

		expect(result.status).toBe('found');
		if (result.status !== 'found') throw new Error('Expected a found object');
		expect(result.object.identity.generation).toBe(
			`sha256:${createHash('sha256').update(payload).digest('hex')}`
		);
	});

	it('passes the caller AbortSignal to fetch and maps aborts explicitly', async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | null | undefined;
		const source = createSource(async (_input, init) => {
			observedSignal = init?.signal;
			controller.abort(new DOMException('stopped', 'AbortError'));
			throw controller.signal.reason;
		}, new RecordingIngressLimiter());

		await expectSourceError(
			() => source.readBatch(batchObjectKey, controller.signal),
			'aborted'
		);
		expect(observedSignal?.aborted).toBe(true);
	});

	it('maps an already-aborted request without invoking fetch', async () => {
		const controller = new AbortController();
		controller.abort(new DOMException('stopped', 'AbortError'));
		let fetchCalled = false;
		const source = createSource(async () => {
			fetchCalled = true;
			return new Response('unused');
		}, new RecordingIngressLimiter());

		await expectSourceError(
			() => source.readBatch(batchObjectKey, controller.signal),
			'aborted'
		);
		expect(fetchCalled).toBe(false);
	});

	it('enforces a bounded request deadline independently of caller aborts', async () => {
		const source = createSource(
			async (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(init.signal?.reason),
						{ once: true }
					);
				}),
			new RecordingIngressLimiter(),
			1_024,
			5
		);

		await expectSourceError(
			() => source.readBatch(batchObjectKey, new AbortController().signal),
			'request-timeout'
		);
	});

	it('maps transport failures without exposing response bodies', async () => {
		const source = createSource(async () => {
			throw new Error('socket closed');
		}, new RecordingIngressLimiter());

		await expectSourceError(
			() => source.readBatch(batchObjectKey, new AbortController().signal),
			'network-failure'
		);
	});

	it('rejects non-HTTPS configuration and object-key path escapes', async () => {
		expect(
			() =>
				new AnonymousHttpSep54LedgerCloseMetaSource({
					baseUrl: 'http://objects.example.test',
					ingressLimiter: new RecordingIngressLimiter(),
					ledgersPath,
					maximumResponseBytes: 1_024,
					requestTimeoutMilliseconds: 30_000
				})
		).toThrow(AnonymousHttpSep54SourceError);

		const source = createSource(
			async () => new Response('unused'),
			new RecordingIngressLimiter()
		);
		await expectSourceError(
			() =>
				source.readBatch(
					`${ledgersPath}/../secret.xdr.zst`,
					new AbortController().signal
				),
			'invalid-object-key'
		);
		await expectSourceError(
			() =>
				source.readBatch(
					'other/path/FFFFFFFC--3.xdr.zst',
					new AbortController().signal
				),
			'invalid-object-key'
		);
	});
});

class RecordingIngressLimiter implements IngressByteRateLimiter {
	readonly byteCounts: number[] = [];
	readonly signals: AbortSignal[] = [];

	throttle(byteCount: number, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		this.byteCounts.push(byteCount);
		this.signals.push(signal);
		return Promise.resolve();
	}
}

function createSource(
	fetchFn: AnonymousHttpSep54Fetch,
	ingressLimiter: IngressByteRateLimiter,
	maximumResponseBytes = 1_024,
	requestTimeoutMilliseconds = 30_000
): AnonymousHttpSep54LedgerCloseMetaSource {
	return new AnonymousHttpSep54LedgerCloseMetaSource({
		baseUrl,
		fetchFn,
		ingressLimiter,
		ledgersPath,
		maximumResponseBytes,
		requestTimeoutMilliseconds
	});
}

function chunkedResponse(
	chunks: readonly Uint8Array[],
	headers?: HeadersInit
): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			}
		}),
		{ headers }
	);
}

async function expectSourceError(
	action: () => Promise<unknown>,
	reason: AnonymousHttpSep54SourceFailureReason,
	status?: number
): Promise<void> {
	try {
		await action();
		throw new Error(`Expected ${reason}`);
	} catch (error) {
		expect(error).toBeInstanceOf(AnonymousHttpSep54SourceError);
		const sourceError = error as AnonymousHttpSep54SourceError;
		expect(sourceError.reason).toBe(reason);
		if (status !== undefined) expect(sourceError.status).toBe(status);
	}
}
