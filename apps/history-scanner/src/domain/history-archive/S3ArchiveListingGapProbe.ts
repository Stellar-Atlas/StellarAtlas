import { createHash } from 'node:crypto';
import type { HistoryArchiveListingGapDTO } from 'history-scanner-dto';
import {
	bounded,
	CATEGORIES,
	checkpointKey,
	parseListing,
	readLimited,
	validCheckpoint,
	type Category,
	type GcsArchiveListingGapInput
} from './GcsArchiveListingGapProbe.js';
import {
	listingInputRoot,
	objectRootPrefix,
	UnavailableListingCapabilityCache
} from './ArchiveListingProbeSupport.js';

export interface S3ArchiveListingGapDependencies {
	fetch: typeof fetch;
	now: () => Date;
	s3CapabilityCache: UnavailableListingCapabilityCache;
}

const unavailable = new UnavailableListingCapabilityCache();

function firstListedCheckpoint(
	body: Buffer,
	prefix: string,
	category: Category,
	marker: string
): { key: string; checkpoint: number } | null {
	const listing = parseListing(
		new TextDecoder('utf-8', { fatal: true }).decode(body)
	);
	const { fields, keys } = listing;
	if (
		!fields.get('Name') ||
		fields.get('Prefix') !== prefix + category + '/' ||
		fields.get('StartAfter') !== marker ||
		fields.get('MaxKeys') !== '2' ||
		!['true', 'false'].includes(fields.get('IsTruncated') ?? '') ||
		fields.has('EncodingType') ||
		keys.length === 0 ||
		keys.length > 2 ||
		(fields.has('KeyCount') && fields.get('KeyCount') !== String(keys.length))
	)
		return null;
	let previous = marker;
	let first: { key: string; checkpoint: number } | null = null;
	for (const key of keys) {
		const hex = key.match(/-([0-9a-f]{8})\.(?:json|xdr\.gz)$/)?.[1];
		if (!hex || key <= previous) return null;
		const checkpoint = Number.parseInt(hex, 16);
		if (
			!validCheckpoint(checkpoint) ||
			key !== checkpointKey(prefix, category, checkpoint)
		)
			return null;
		first ??= { key, checkpoint };
		previous = key;
	}
	return first;
}

/** S3-compatible listing is queried at the advertised origin, never a guessed storage backend. */
export async function probeS3ArchiveListingGap(
	input: GcsArchiveListingGapInput,
	dependencies: Partial<S3ArchiveListingGapDependencies> = {}
): Promise<HistoryArchiveListingGapDTO | null> {
	const root = listingInputRoot(input);
	if (!root) return null;
	const now = dependencies.now ?? (() => new Date());
	const cache = dependencies.s3CapabilityCache ?? unavailable;
	if (cache.has(root.href, now().getTime())) return null;
	const fetcher = dependencies.fetch ?? fetch;
	const prefix = objectRootPrefix(root);
	const listings: Array<HistoryArchiveListingGapDTO['listings'][number]> = [];
	let through = 2147483583;
	try {
		for (const category of CATEGORIES) {
			const marker =
				input.checkpoint === 63
					? prefix + category + '/'
					: checkpointKey(prefix, category, input.checkpoint - 64);
			const url = new URL('/', root);
			url.searchParams.set('list-type', '2');
			url.searchParams.set('prefix', prefix + category + '/');
			url.searchParams.set('start-after', marker);
			url.searchParams.set('max-keys', '2');
			const signal = AbortSignal.timeout(5000);
			const response = await bounded(
				fetcher(url.href, { signal, redirect: 'error' }),
				signal
			);
			if (response.status !== 200) {
				void response.body?.cancel().catch(() => undefined);
				if ([400, 401, 403, 404, 405].includes(response.status))
					cache.mark(root.href, now().getTime());
				return null;
			}
			const body = await readLimited(response, signal);
			let first: ReturnType<typeof firstListedCheckpoint>;
			try {
				first = firstListedCheckpoint(body, prefix, category, marker);
			} catch {
				cache.mark(root.href, now().getTime());
				return null;
			}
			if (!first) {
				cache.mark(root.href, now().getTime());
				return null;
			}
			if (first.checkpoint <= input.checkpoint + 64) return null;
			through = Math.min(through, first.checkpoint - 64);
			listings.push({
				category,
				listingUrl: url.href,
				responseSha256: createHash('sha256').update(body).digest('hex'),
				firstReturnedKey: first.key,
				firstReturnedCheckpoint: first.checkpoint
			});
		}
		return {
			kind: 's3-listing-gap',
			archiveRoot: input.archiveRoot,
			missingFromCheckpoint: input.checkpoint,
			missingThroughCheckpoint: through,
			observedAt: now().toISOString(),
			listings
		};
	} catch {
		return null;
	}
}
