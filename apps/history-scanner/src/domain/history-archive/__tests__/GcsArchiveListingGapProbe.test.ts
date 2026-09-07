import { jest } from '@jest/globals';
import {
	probeGcsArchiveListingGap,
	GcsArchiveListingCapabilityCache,
	type GcsArchiveListingGapInput
} from '../GcsArchiveListingGapProbe.js';

const ROOT = 'http://stellar-history.ylds.com/validator-us-west1-0';
const CHECKPOINT = 1087;
const NEXT = 64_205_951;
const NOW = new Date('2026-09-06T22:43:57.145Z');

function key(
	category: string,
	checkpoint: number,
	prefix = 'validator-us-west1-0/'
) {
	const hex = checkpoint.toString(16).padStart(8, '0');
	return `${prefix}${category}/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 6)}/${category}-${hex}${category === 'history' ? '.json' : '.xdr.gz'}`;
}

function input(
	root = ROOT,
	checkpoint = CHECKPOINT
): GcsArchiveListingGapInput {
	return {
		archiveRoot: root,
		checkpoint,
		observedHttpStatus: 404,
		failedObjectUrl: `${root}/${key('history', checkpoint, '')}`
	};
}

function xml(url: URL, keys: string[], truncated = true) {
	return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://doc.s3.amazonaws.com/2006-03-01">
	<Name>${url.pathname.slice(1)}</Name><Prefix>${url.searchParams.get('prefix')}</Prefix>
	<Marker>${url.searchParams.get('marker')}</Marker><MaxKeys>2</MaxKeys>
	<IsTruncated>${truncated}</IsTruncated>${keys.map((value) => `<Contents><Key>${value}</Key><Size>42</Size></Contents>`).join('')}
	</ListBucketResult>`;
}

function harness(
	change?: (body: string, url: URL) => string,
	next: Record<string, number> = {}
) {
	const requests: URL[] = [];
	let active = 0;
	let maxActive = 0;
	const fetcher = jest.fn<typeof fetch>(async (value) => {
		active++;
		maxActive = Math.max(maxActive, active);
		const url = new URL(String(value));
		requests.push(url);
		const prefix = url.searchParams.get('prefix')!;
		const category = prefix.split('/').at(-2)!;
		const rootPrefix = prefix.slice(0, -category.length - 1);
		const position = next[category] ?? NEXT;
		const body = xml(url, [
			key(category, position, rootPrefix),
			key(category, position + 64, rootPrefix)
		]);
		await Promise.resolve();
		active--;
		return new Response(change ? change(body, url) : body);
	});
	const resolver = jest
		.fn<() => Promise<string[]>>()
		.mockResolvedValue(['c.storage.googleapis.com.']);
	return {
		fetcher,
		resolver,
		requests,
		maxActive: () => maxActive,
		deps: {
			fetch: fetcher,
			resolveCname: resolver,
			now: () => NOW,
			capabilityCache: new GcsArchiveListingCapabilityCache()
		}
	};
}

it('records the common four-category YLDS gap using four sequential bounded listing requests', async () => {
	const h = harness();
	const gap = await probeGcsArchiveListingGap(input(), h.deps);
	expect(gap).toMatchObject({
		kind: 'gcs-listing-gap',
		archiveRoot: ROOT,
		missingFromCheckpoint: CHECKPOINT,
		missingThroughCheckpoint: NEXT - 64,
		observedAt: NOW.toISOString()
	});
	expect(gap?.listings.map((listing) => listing.category)).toEqual([
		'history',
		'ledger',
		'transactions',
		'results'
	]);
	expect(
		gap?.listings.every((listing) =>
			/^[a-f0-9]{64}$/.test(listing.responseSha256)
		)
	).toBe(true);
	expect(h.requests).toHaveLength(4);
	expect(h.maxActive()).toBe(1);
	expect(h.requests[0].searchParams.get('marker')).toBe(key('history', 1023));
	expect(h.fetcher.mock.calls[0][1]).toMatchObject({
		redirect: 'error',
		signal: expect.any(AbortSignal)
	});
});

it('intersects gaps rather than skipping files available in any required category', async () => {
	const h = harness(undefined, { ledger: 1279, transactions: 1343 });
	expect(
		(await probeGcsArchiveListingGap(input(), h.deps))?.missingThroughCheckpoint
	).toBe(1215);
});

it.each(['history', 'ledger', 'transactions', 'results'])(
	'refuses a gap when %s lists the failed position',
	async (category) => {
		const h = harness(undefined, { [category]: CHECKPOINT });
		expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	}
);

it('requires at least two absent checkpoint positions to justify listing acceleration', async () => {
	const h = harness(undefined, { history: CHECKPOINT + 64 });
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.requests).toHaveLength(1);
});

it.each([401, 403, 404, 429, 500])(
	'does not classify denied or failed listing HTTP %s as absent files',
	async (status) => {
		const h = harness();
		h.fetcher.mockResolvedValue(new Response('AccessDenied', { status }));
		expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
		expect(h.fetcher).toHaveBeenCalledTimes(1);
	}
);

it.each([
	[
		'prefix',
		(body: string) => body.replace('<Prefix>validator-', '<Prefix>wrong-')
	],
	[
		'marker',
		(body: string) => body.replace('<Marker>validator-', '<Marker>wrong-')
	],
	[
		'bucket',
		(body: string) =>
			body.replace('<Name>stellar-history.ylds.com', '<Name>another-bucket')
	],
	['max keys', (body: string) => body.replace('<MaxKeys>2', '<MaxKeys>1000')],
	[
		'truncated flag',
		(body: string) => body.replace('<IsTruncated>true', '<IsTruncated>yes')
	],
	['malformed XML', (body: string) => body.replace('</Marker>', '</Wrong>')],
	[
		'DTD',
		(body: string) =>
			body.replace(
				'<ListBucketResult',
				'<!DOCTYPE ListBucketResult><ListBucketResult'
			)
	],
	[
		'duplicate marker',
		(body: string) =>
			body.replace('</Marker>', '</Marker><Marker>wrong</Marker>')
	],
	[
		'malformed path',
		(body: string) => body.replaceAll('/03/d3/b4/', '/03/ff/b4/')
	],
	[
		'non-checkpoint key',
		(body: string) => body.replaceAll('03d3b47f', '03d3b480')
	]
] as const)(
	'falls back for invalid %s without changing the original failure',
	async (_, change) => {
		const h = harness(change);
		expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	}
);

it('rejects out-of-order keys, even if each filename is individually valid', async () => {
	const h = harness((_, url) =>
		xml(url, [key('history', NEXT + 64), key('history', NEXT)])
	);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
});

it.each([true, false])(
	'does not infer an unbounded tail from an empty listing (truncated=%s)',
	async (truncated) => {
		const h = harness((_, url) => xml(url, [], truncated));
		expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	}
);

it('refuses unsupported hosts without listing requests', async () => {
	const h = harness();
	h.resolver.mockResolvedValue(['cloudfront.example.net']);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.fetcher).not.toHaveBeenCalled();
});

it('supports native GCS roots and preserves case-sensitive object prefixes', async () => {
	const h = harness();
	const root = 'https://storage.googleapis.com/example-bucket/Case/Root';
	const gap = await probeGcsArchiveListingGap(input(root), h.deps);
	expect(gap?.listings[0].firstReturnedKey).toBe(
		key('history', NEXT, 'Case/Root/')
	);
	expect(h.resolver).not.toHaveBeenCalled();
});

it('supports native virtual-hosted GCS roots without DNS resolution', async () => {
	const h = harness();
	expect(
		await probeGcsArchiveListingGap(
			input('https://example-bucket.storage.googleapis.com/Case'),
			h.deps
		)
	).not.toBeNull();
	expect(h.resolver).not.toHaveBeenCalled();
});

it('uses the category prefix as the before-genesis marker', async () => {
	const h = harness();
	expect(
		await probeGcsArchiveListingGap(input(ROOT, 63), h.deps)
	).not.toBeNull();
	expect(h.requests[0].searchParams.get('marker')).toBe(
		'validator-us-west1-0/history/'
	);
});

it('requires the failed URL to match the declared archive root and exact checkpoint path', async () => {
	const h = harness();
	expect(
		await probeGcsArchiveListingGap(
			{ ...input(), failedObjectUrl: `${ROOT}/WRONG` },
			h.deps
		)
	).toBeNull();
	expect(h.fetcher).not.toHaveBeenCalled();
	expect(h.resolver).not.toHaveBeenCalled();
});

it.each([403, 200, 500])(
	'does not probe listing capability for original HTTP %s',
	async (observedHttpStatus) => {
		const h = harness();
		expect(
			await probeGcsArchiveListingGap(
				{ ...input(), observedHttpStatus },
				h.deps
			)
		).toBeNull();
		expect(h.fetcher).not.toHaveBeenCalled();
	}
);

it('abandons an oversized listing body', async () => {
	const h = harness(() => 'x'.repeat(65_537));
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('falls back on a fetch timeout and does not issue more requests', async () => {
	const h = harness();
	h.fetcher.mockRejectedValue(
		new DOMException('Request timed out', 'TimeoutError')
	);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('bounds a transport that does not settle itself when its signal expires', async () => {
	const h = harness();
	const controller = new AbortController();
	const timeout = jest
		.spyOn(AbortSignal, 'timeout')
		.mockReturnValue(controller.signal);
	h.fetcher.mockImplementation(() => {
		queueMicrotask(() =>
			controller.abort(new DOMException('Timed out', 'TimeoutError'))
		);
		return new Promise<Response>(() => undefined);
	});
	try {
		expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
		expect(h.fetcher).toHaveBeenCalledTimes(1);
	} finally {
		timeout.mockRestore();
	}
});

it('caches unsupported capabilities for one hour but never caches missing-file results', async () => {
	const h = harness();
	h.resolver.mockResolvedValue([]);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(
		await probeGcsArchiveListingGap(input(ROOT, CHECKPOINT + 64), h.deps)
	).toBeNull();
	expect(h.resolver).toHaveBeenCalledTimes(1);
	h.deps.now = () => new Date(NOW.getTime() + 3_600_001);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.resolver).toHaveBeenCalledTimes(2);
});

it('caches listing access denial so later 404 objects do not repeat the listing request', async () => {
	const h = harness();
	h.fetcher.mockResolvedValue(new Response('AccessDenied', { status: 403 }));
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(
		await probeGcsArchiveListingGap(input(ROOT, CHECKPOINT + 64), h.deps)
	).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(1);
	expect(h.resolver).toHaveBeenCalledTimes(1);
});

it('bounds the capability cache to 256 roots with least-recently-used eviction', () => {
	const cache = new GcsArchiveListingCapabilityCache();
	for (let i = 0; i < 256; i++) cache.set(`root-${i}`, null, 0);
	expect(cache.get('root-0', 1)).toBeNull();
	cache.set('root-256', null, 1);
	expect(cache.get('root-1', 1)).toBeUndefined();
	expect(cache.get('root-0', 1)).toBeNull();
	expect(cache.get('root-256', 1)).toBeNull();
});

it('reuses provider discovery but downloads fresh listing evidence for each gap observation', async () => {
	const h = harness();
	expect(await probeGcsArchiveListingGap(input(), h.deps)).not.toBeNull();
	expect(
		await probeGcsArchiveListingGap(input(ROOT, CHECKPOINT + 64), h.deps)
	).not.toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(8);
	expect(h.resolver).toHaveBeenCalledTimes(1);
});

it('caches the absence of CNAME records without calling the listing endpoint', async () => {
	const h = harness();
	h.resolver.mockRejectedValue(
		Object.assign(new Error('No CNAME'), { code: 'ENODATA' })
	);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.resolver).toHaveBeenCalledTimes(1);
	expect(h.fetcher).not.toHaveBeenCalled();
});

it('rejects duplicate object keys inside one Contents element', async () => {
	const h = harness((body) =>
		body.replace('</Key>', `</Key><Key>${key('history', NEXT + 128)}</Key>`)
	);
	expect(await probeGcsArchiveListingGap(input(), h.deps)).toBeNull();
});
