import { jest } from '@jest/globals';
import { probeS3ArchiveListingGap } from '../S3ArchiveListingGapProbe.js';
import { UnavailableListingCapabilityCache } from '../ArchiveListingProbeSupport.js';
import { checkpointKey, type Category } from '../GcsArchiveListingGapProbe.js';
import { isHistoryArchiveListingGapDTO } from '../../../../../../packages/history-scanner-dto/src/HistoryArchiveListingGapDTO.js';

const root = 'https://stellar-full-history1.bdnodes.net';
const start = 1087;
const input = {
	archiveRoot: root,
	checkpoint: start,
	failedObjectUrl: root + '/' + checkpointKey('', 'history', start),
	observedHttpStatus: 404
};

function harness(
	change?: (xml: string) => string,
	positions: Partial<Record<Category, number>> = {}
) {
	const fetcher = jest.fn<typeof fetch>(async (value) => {
		const url = new URL(String(value));
		const prefix = url.searchParams.get('prefix')!;
		const category = prefix.split('/').at(-2) as Category;
		const position = positions[category] ?? 1343;
		const body = `<?xml version='1.0' encoding='UTF-8'?><ListBucketResult xmlns='http://doc.s3.amazonaws.com/2006-03-01'>
		<Name>stellar-full-validator-a</Name><Prefix>${prefix}</Prefix><StartAfter>${url.searchParams.get('start-after')}</StartAfter>
		<NextContinuationToken>opaque-token</NextContinuationToken><KeyCount>2</KeyCount><MaxKeys>2</MaxKeys><IsTruncated>true</IsTruncated>
		<Contents><Key>${checkpointKey('', category, position)}</Key><Generation>1570639749681647</Generation><Size>3432</Size></Contents>
		<Contents><Key>${checkpointKey('', category, position + 64)}</Key><Size>3432</Size></Contents></ListBucketResult>`;
		return new Response(change ? change(body) : body, {
			headers: { 'content-type': 'application/xml; charset=UTF-8' }
		});
	});
	const deps = {
		fetch: fetcher,
		now: () => new Date('2026-09-06T22:43:57Z'),
		s3CapabilityCache: new UnavailableListingCapabilityCache()
	};
	return { fetcher, deps };
}

it('uses the advertised Blockdaemon origin and validates all four StartAfter listings', async () => {
	const h = harness();
	const gap = await probeS3ArchiveListingGap(input, h.deps);
	expect(gap).toMatchObject({
		kind: 's3-listing-gap',
		missingFromCheckpoint: 1087,
		missingThroughCheckpoint: 1279
	});
	expect(isHistoryArchiveListingGapDTO(gap)).toBe(true);
	expect(h.fetcher).toHaveBeenCalledTimes(4);
	const url = new URL(String(h.fetcher.mock.calls[0][0]));
	expect(url.origin).toBe(root);
	expect(url.pathname).toBe('/');
	expect(url.searchParams.get('start-after')).toBe(
		checkpointKey('', 'history', 1023)
	);
	expect(h.fetcher.mock.calls[0][1]?.redirect).toBe('error');
});

it('intersects required categories instead of skipping a present ledger file', async () => {
	const h = harness(undefined, { ledger: 1279 });
	expect(
		(await probeS3ArchiveListingGap(input, h.deps))?.missingThroughCheckpoint
	).toBe(1215);
});

it.each(['history', 'ledger', 'transactions', 'results'] as const)(
	'does not infer an entire missing checkpoint when %s exists',
	async (category) => {
		const h = harness(undefined, { [category]: start });
		expect(await probeS3ArchiveListingGap(input, h.deps)).toBeNull();
	}
);

it.each([
	[
		'ignored StartAfter',
		(xml: string) => xml.replace(/<StartAfter>.*?<\/StartAfter>/, '')
	],
	[
		'wrong StartAfter',
		(xml: string) => xml.replace('<StartAfter>history/', '<StartAfter>wrong/')
	],
	[
		'wrong Prefix',
		(xml: string) => xml.replace('<Prefix>history/', '<Prefix>wrong/')
	],
	[
		'inconsistent KeyCount',
		(xml: string) => xml.replace('<KeyCount>2', '<KeyCount>1')
	],
	['malformed XML', (xml: string) => xml.replace('</ListBucketResult>', '')],
	[
		'URL encoded keys',
		(xml: string) =>
			xml.replace('<MaxKeys>', '<EncodingType>url</EncodingType><MaxKeys>')
	]
] as const)('falls back when %s makes absence ambiguous', async (_, change) => {
	const h = harness(change);
	expect(await probeS3ArchiveListingGap(input, h.deps)).toBeNull();
});

it('caches denied listing capability without changing the original object failure', async () => {
	const h = harness();
	h.fetcher.mockResolvedValue(new Response('AccessDenied', { status: 403 }));
	expect(await probeS3ArchiveListingGap(input, h.deps)).toBeNull();
	expect(await probeS3ArchiveListingGap(input, h.deps)).toBeNull();
	expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('never treats an empty truncated listing as an unbounded missing tail', async () => {
	const h = harness((xml) =>
		xml
			.replace(/<Contents>.*?<\/Contents>/gs, '')
			.replace('<KeyCount>2', '<KeyCount>0')
	);
	expect(await probeS3ArchiveListingGap(input, h.deps)).toBeNull();
});
