import { createHash } from 'node:crypto';
import type { HistoryArchiveListingGapDTO } from 'history-scanner-dto';
import {
	bounded,
	CATEGORIES,
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
import { parseCompleteArchiveDirectoryIndex } from './CompleteArchiveDirectoryIndex.js';

export interface DirectoryArchiveListingGapDependencies {
	fetch: typeof fetch;
	now: () => Date;
	directoryCapabilityCache: UnavailableListingCapabilityCache;
}

const unavailable = new UnavailableListingCapabilityCache();
type Evidence = HistoryArchiveListingGapDTO['listings'][number];
interface Index {
	links: string[];
	url: URL;
	hash: string;
}

function prefixThrough(hexPrefix: string): number {
	return Number.parseInt(hexPrefix.padEnd(8, 'f'), 16);
}

function evidence(
	category: Category,
	index: Index,
	completePrefix: string,
	rangeThroughCheckpoint: number
): Evidence {
	return {
		category,
		listingUrl: index.url.href,
		responseSha256: index.hash,
		completePrefix,
		rangeThroughCheckpoint,
		firstReturnedKey: null,
		firstReturnedCheckpoint: null
	};
}

function leafEnd(
	index: Index,
	category: Category,
	hexPrefix: string,
	start: number
): number | null {
	let end = prefixThrough(hexPrefix);
	for (const filename of index.links) {
		const match = filename.match(
			new RegExp(
				'^' +
					category +
					'-([0-9a-f]{8})' +
					(category === 'history' ? '\\.json' : '\\.xdr\\.gz') +
					'$'
			)
		);
		if (!match || !match[1].startsWith(hexPrefix)) return null;
		const checkpoint = Number.parseInt(match[1], 16);
		if (checkpoint !== 0 && !validCheckpoint(checkpoint)) return null;
		if (checkpoint === start) return null;
		if (checkpoint > start) end = Math.min(end, checkpoint - 64);
	}
	return end;
}

/** Only complete directory indexes can establish absence; a denied/404 index cannot. */
export async function probeDirectoryArchiveListingGap(
	input: GcsArchiveListingGapInput,
	dependencies: Partial<DirectoryArchiveListingGapDependencies> = {}
): Promise<HistoryArchiveListingGapDTO | null> {
	const root = listingInputRoot(input);
	if (!root) return null;
	const fetcher = dependencies.fetch ?? fetch;
	const now = dependencies.now ?? (() => new Date());
	const cache = dependencies.directoryCapabilityCache ?? unavailable;
	if (cache.has(root.href, now().getTime())) return null;
	const prefix = objectRootPrefix(root);
	const hex = input.checkpoint.toString(16).padStart(8, '0');
	const pieces = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
	let requests = 0;
	const readIndex = async (
		keyPrefix: string
	): Promise<Index | 'missing' | null> => {
		if (++requests > 12) return null;
		const url = new URL('/' + keyPrefix, root);
		const signal = AbortSignal.timeout(5000);
		const response = await bounded(
			fetcher(url.href, { signal, redirect: 'error' }),
			signal
		);
		if (response.status !== 200) {
			void response.body?.cancel().catch(() => undefined);
			if (response.status === 404) return 'missing';
			if ([400, 401, 403, 405].includes(response.status))
				cache.mark(root.href, now().getTime());
			return null;
		}
		const body = await readLimited(response, signal);
		const links = parseCompleteArchiveDirectoryIndex(
			new TextDecoder('utf-8', { fatal: true }).decode(body),
			url.pathname
		);
		if (links === null) {
			cache.mark(root.href, now().getTime());
			return null;
		}
		return {
			links,
			url,
			hash: createHash('sha256').update(body).digest('hex')
		};
	};
	const listings: Evidence[] = [];
	try {
		for (const category of CATEGORIES) {
			const categoryPrefix = prefix + category + '/';
			let found: Evidence | null = null;
			// Parent-of-leaf first: missing branches can be established without crawling their children.
			for (let parentDepth = 2; parentDepth >= 0; parentDepth--) {
				const parentPrefix =
					categoryPrefix +
					pieces
						.slice(0, parentDepth)
						.map((piece) => piece + '/')
						.join('');
				const parent = await readIndex(parentPrefix);
				if (parent === 'missing') continue;
				if (
					!parent ||
					parent.links.some((link) => !/^[0-9a-f]{2}\/$/.test(link))
				)
					return null;
				const child = pieces[parentDepth] + '/';
				const childPrefix = parentPrefix + child;
				if (!parent.links.includes(child)) {
					found = evidence(
						category,
						parent,
						childPrefix,
						prefixThrough(pieces.slice(0, parentDepth + 1).join(''))
					);
					break;
				}
				// A listed ancestor that just returned 404 is contradictory, not proof of an empty subtree.
				if (parentDepth !== 2) return null;
				const leaf = await readIndex(childPrefix);
				if (!leaf || leaf === 'missing') return null;
				const end = leafEnd(leaf, category, pieces.join(''), input.checkpoint);
				if (end === null) return null;
				found = evidence(category, leaf, childPrefix, end);
				break;
			}
			if (!found) {
				cache.mark(root.href, now().getTime());
				return null;
			}
			if (
				found.rangeThroughCheckpoint === undefined ||
				found.rangeThroughCheckpoint < input.checkpoint + 64
			)
				return null;
			listings.push(found);
		}
		return {
			kind: 'directory-listing-gap',
			archiveRoot: input.archiveRoot,
			observedAt: now().toISOString(),
			missingFromCheckpoint: input.checkpoint,
			missingThroughCheckpoint: Math.min(
				...listings.map((item) => item.rangeThroughCheckpoint!)
			),
			listings
		};
	} catch {
		return null;
	}
}
