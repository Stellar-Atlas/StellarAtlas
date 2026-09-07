import { jest } from '@jest/globals';
import { probeDirectoryArchiveListingGap } from '../DirectoryArchiveListingGapProbe.js';
import { parseCompleteArchiveDirectoryIndex } from '../CompleteArchiveDirectoryIndex.js';
import { UnavailableListingCapabilityCache } from '../ArchiveListingProbeSupport.js';
import { probeArchiveListingGap } from '../ArchiveListingGapProbe.js';
import {
	GcsArchiveListingCapabilityCache,
	checkpointKey,
	type Category
} from '../GcsArchiveListingGapProbe.js';
import { isHistoryArchiveListingGapDTO } from '../../../../../../packages/history-scanner-dto/src/HistoryArchiveListingGapDTO.js';

const ROOT = 'https://hercules-history.publicnode.org';
const START = 1087;
function input(root = ROOT) {
	return {
		archiveRoot: root,
		checkpoint: START,
		observedHttpStatus: 404,
		failedObjectUrl: root + '/' + checkpointKey('', 'history', START)
	};
}

function index(path: string, links: string[]): string {
	return `<html>\r\n<head><title>Index of ${path}</title></head>\r\n<body>\r\n<h1>Index of ${path}</h1><hr><pre><a href="../">../</a>\r\n${links.map((link) => `<a href="${link}">${link}</a>                              21-Sep-2024 14:08                ${link.endsWith('/') ? '-' : '3089'}\r\n`).join('')}</pre><hr></body>\r\n</html>\r\n`;
}

function harness(route?: (url: URL) => Response) {
	const fetcher = jest.fn<typeof fetch>(async (value) => {
		const url = new URL(String(value));
		if (route) return route(url);
		if (url.pathname.endsWith('/00/00/'))
			return new Response(index(url.pathname, ['04/']));
		if (url.pathname.endsWith('/00/00/04/'))
			return new Response(index(url.pathname, []));
		return new Response('No index', { status: 404 });
	});
	const deps = {
		fetch: fetcher,
		now: () => new Date('2026-09-06T22:43:57Z'),
		directoryCapabilityCache: new UnavailableListingCapabilityCache(),
		s3CapabilityCache: new UnavailableListingCapabilityCache(),
		capabilityCache: new GcsArchiveListingCapabilityCache(),
		resolveCname: async () => []
	};
	return { fetcher, deps };
}

it('parses the exact complete PublicNode autoindex shape without treating it as arbitrary HTML', () => {
	const links = [
		'history-00000000.json',
		'history-0000003f.json',
		'history-0000007f.json',
		'history-000000bf.json',
		'history-000000ff.json'
	];
	expect(
		parseCompleteArchiveDirectoryIndex(
			index('/history/00/00/00/', links),
			'/history/00/00/00/'
		)
	).toEqual(links);
});

it('records a common missing range only after complete leaf indexes in all four categories', async () => {
	const h = harness();
	const gap = await probeDirectoryArchiveListingGap(input(), h.deps);
	expect(gap).toMatchObject({
		kind: 'directory-listing-gap',
		missingFromCheckpoint: START,
		missingThroughCheckpoint: 1279
	});
	expect(gap?.listings[0]).toMatchObject({
		completePrefix: 'history/00/00/04/',
		rangeThroughCheckpoint: 1279,
		firstReturnedKey: null,
		firstReturnedCheckpoint: null
	});
	expect(h.fetcher).toHaveBeenCalledTimes(8);
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it('preserves case-sensitive archive root prefixes in directory evidence', async () => {
	const h = harness();
	const gap = await probeDirectoryArchiveListingGap(
		input(ROOT + '/Case'),
		h.deps
	);
	expect(gap?.listings[0].completePrefix).toBe('Case/history/00/00/04/');
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it('uses complete parent listings to prove absent leaf subtrees without querying each file', async () => {
	const h = harness((url) => new Response(index(url.pathname, ['05/'])));
	const gap = await probeDirectoryArchiveListingGap(input(), h.deps);
	expect(gap?.missingThroughCheckpoint).toBe(1279);
	expect(gap?.listings[0].listingUrl).toBe(ROOT + '/history/00/00/');
	expect(h.fetcher).toHaveBeenCalledTimes(4);
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it('walks up only after 404 and bounds an absent larger subtree to its hex prefix', async () => {
	const h = harness((url) =>
		url.pathname.endsWith('/00/00/')
			? new Response('', { status: 404 })
			: new Response(index(url.pathname, ['01/']))
	);
	const gap = await probeDirectoryArchiveListingGap(input(), h.deps);
	expect(gap?.missingThroughCheckpoint).toBe(65535);
	expect(gap?.listings[0].completePrefix).toBe('history/00/00/');
	expect(h.fetcher).toHaveBeenCalledTimes(8);
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it('can establish a missing top-level subtree in at most twelve sequential requests', async () => {
	const h = harness((url) =>
		/\/00\/$/.test(url.pathname)
			? new Response('', { status: 404 })
			: new Response(index(url.pathname, ['01/']))
	);
	const gap = await probeDirectoryArchiveListingGap(input(), h.deps);
	expect(gap?.missingThroughCheckpoint).toBe(16777215);
	expect(h.fetcher).toHaveBeenCalledTimes(12);
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it('intersects leaf gaps at the next present required checkpoint', async () => {
	const h = harness((url) => {
		if (url.pathname.endsWith('/00/00/'))
			return new Response(index(url.pathname, ['04/']));
		const category = url.pathname.split('/')[1] as Category;
		return new Response(
			index(
				url.pathname,
				category === 'ledger' ? ['ledger-000004bf.xdr.gz'] : []
			)
		);
	});
	const gap = await probeDirectoryArchiveListingGap(input(), h.deps);
	expect(gap?.missingThroughCheckpoint).toBe(1151);
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
});

it.each(['history', 'ledger', 'transactions', 'results'] as const)(
	'does not skip an entire checkpoint when %s lists the actual failed position',
	async (category) => {
		const h = harness((url) =>
			url.pathname.endsWith('/00/00/')
				? new Response(index(url.pathname, ['04/']))
				: new Response(
						index(
							url.pathname,
							url.pathname.startsWith('/' + category + '/')
								? [
										category +
											'-0000043f' +
											(category === 'history' ? '.json' : '.xdr.gz')
									]
								: []
						)
					)
		);
		expect(await probeDirectoryArchiveListingGap(input(), h.deps)).toBeNull();
	}
);

it.each([
	['truncation', (body: string) => body.replace('</html>', '')],
	[
		'pagination link',
		(body: string) => body.replace('</pre>', '<a href="?page=2">Next</a></pre>')
	],
	[
		'pagination text',
		(body: string) => body.replace('</pre>', 'Showing first 100 files</pre>')
	],
	[
		'incorrect title',
		(body: string) => body.replaceAll('Index of /history/', 'Index of /other/')
	],
	[
		'script',
		(body: string) =>
			body.replace('</body>', '<script>loadMore()</script></body>')
	],
	[
		'hidden continuation',
		(body: string) => body.replace('</pre>', '<!--more--></pre>')
	],
	[
		'traversal',
		(body: string) =>
			body.replace('</pre>', '<a href="../../escape/">../../escape/</a></pre>')
	]
] as const)(
	'rejects %s rather than infer absence from a partial or unrelated page',
	(_, change) => {
		expect(
			parseCompleteArchiveDirectoryIndex(
				change(index('/history/00/00/04/', [])),
				'/history/00/00/04/'
			)
		).toBeNull();
	}
);

it('does not treat a listed child that returns 404 as a proven empty subtree', async () => {
	const h = harness((url) =>
		url.pathname.endsWith('/00/00/')
			? new Response('', { status: 404 })
			: new Response(index(url.pathname, ['00/']))
	);
	expect(await probeDirectoryArchiveListingGap(input(), h.deps)).toBeNull();
});

it('caches directory access denial and never substitutes it for missing-file evidence', async () => {
	const h = harness(() => new Response('Access denied', { status: 403 }));
	expect(await probeDirectoryArchiveListingGap(input(), h.deps)).toBeNull();
	expect(await probeDirectoryArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('bounds the whole provider-detection pass to twelve requests and falls back safely', async () => {
	const h = harness((url) =>
		url.search || /\/00\/$/.test(url.pathname)
			? new Response('', { status: 404 })
			: new Response(index(url.pathname, ['01/']))
	);
	expect(await probeArchiveListingGap(input(), h.deps)).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(12);
});

it('routes an unsupported S3 origin to a complete directory listing under the same total budget', async () => {
	const h = harness((url) =>
		url.search
			? new Response('', { status: 404 })
			: new Response(index(url.pathname, ['05/']))
	);
	expect((await probeArchiveListingGap(input(), h.deps))?.kind).toBe(
		'directory-listing-gap'
	);
	expect(h.fetcher).toHaveBeenCalledTimes(5);
});
