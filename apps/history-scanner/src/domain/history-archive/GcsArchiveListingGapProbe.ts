import { createHash } from 'node:crypto';
import { resolveCname } from 'node:dns/promises';
import { SaxesParser } from 'saxes';
import type { HistoryArchiveListingGapDTO } from 'history-scanner-dto';

export type Category = 'history' | 'ledger' | 'transactions' | 'results';
export const CATEGORIES: Category[] = [
	'history',
	'ledger',
	'transactions',
	'results'
];
const MAX_BYTES = 65_536;
const TIMEOUT_MS = 5_000;
const MAX_CHECKPOINT = 0xffff_ffff;

export interface GcsArchiveListingGapInput {
	archiveRoot: string;
	checkpoint: number;
	failedObjectUrl: string;
	observedHttpStatus: number;
}

export interface GcsArchiveListingGapDependencies {
	fetch: typeof fetch;
	resolveCname: (hostname: string) => Promise<string[]>;
	now: () => Date;
	capabilityCache: GcsArchiveListingCapabilityCache;
}

interface GcsLocation {
	bucket: string;
	prefix: string;
}

/** Rebuildable provider capability only; never caches a file's presence or absence. */
export class GcsArchiveListingCapabilityCache {
	private readonly entries = new Map<
		string,
		{ until: number; location: GcsLocation | null }
	>();
	get(root: string, at: number): GcsLocation | null | undefined {
		const entry = this.entries.get(root);
		if (!entry) return undefined;
		this.entries.delete(root);
		if (entry.until <= at) return undefined;
		this.entries.set(root, entry);
		return entry.location;
	}
	set(root: string, location: GcsLocation | null, at: number): void {
		this.entries.delete(root);
		if (this.entries.size >= 256)
			this.entries.delete(this.entries.keys().next().value!);
		this.entries.set(root, { until: at + 3_600_000, location });
	}
}

const defaultCapabilityCache = new GcsArchiveListingCapabilityCache();

export function checkpointKey(
	prefix: string,
	category: Category,
	checkpoint: number
) {
	const hex = checkpoint.toString(16).padStart(8, '0');
	const extension = category === 'history' ? '.json' : '.xdr.gz';
	return `${prefix}${category}/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 6)}/${category}-${hex}${extension}`;
}

export function validCheckpoint(checkpoint: number): boolean {
	return (
		Number.isSafeInteger(checkpoint) &&
		checkpoint >= 63 &&
		checkpoint <= MAX_CHECKPOINT &&
		checkpoint % 64 === 63
	);
}

export async function bounded<T>(
	work: Promise<T>,
	signal: AbortSignal
): Promise<T> {
	signal.throwIfAborted();
	let onAbort: () => void = () => undefined;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
	});
	try {
		return await Promise.race([work, aborted]);
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

async function locateGcs(
	root: URL,
	resolver: GcsArchiveListingGapDependencies['resolveCname'],
	signal: AbortSignal
): Promise<GcsLocation | null> {
	if (
		!['http:', 'https:'].includes(root.protocol) ||
		root.username ||
		root.password ||
		root.port ||
		root.search ||
		root.hash ||
		/%(?:2f|5c|00)/i.test(root.pathname)
	)
		return null;
	const path = decodeURIComponent(root.pathname)
		.replace(/^\//, '')
		.replace(/\/+$/, '');
	let bucket: string;
	let prefix: string;
	if (root.hostname === 'storage.googleapis.com') {
		const slash = path.indexOf('/');
		bucket = slash < 0 ? path : path.slice(0, slash);
		prefix = slash < 0 ? '' : path.slice(slash + 1);
	} else if (root.hostname.endsWith('.storage.googleapis.com')) {
		bucket = root.hostname.slice(0, -'.storage.googleapis.com'.length);
		prefix = path;
	} else {
		let aliases: string[];
		try {
			aliases = await bounded(resolver(root.hostname), signal);
		} catch (error) {
			if (
				error instanceof Error &&
				'code' in error &&
				(error.code === 'ENODATA' || error.code === 'ENOTFOUND')
			)
				return null;
			throw error;
		}
		if (
			!aliases.some(
				(alias) =>
					alias.toLowerCase().replace(/\.$/, '') === 'c.storage.googleapis.com'
			)
		)
			return null;
		bucket = root.hostname;
		prefix = path;
	}
	if (
		!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) ||
		prefix.includes('\\') ||
		/[\u0000-\u001f]/.test(prefix)
	)
		return null;
	return { bucket, prefix: prefix ? `${prefix}/` : '' };
}

export interface Listing {
	keys: string[];
	fields: Map<string, string>;
}

export function parseListing(xml: string): Listing {
	const parser = new SaxesParser({ xmlns: false });
	const stack: string[] = [];
	const fields = new Map<string, string>();
	const keys: string[] = [];
	let text = '';
	let sawRoot = false;
	let contents = 0;
	let contentKeys = 0;
	parser.on('doctype', () => {
		throw new Error('Listing DTD is not allowed');
	});
	parser.on('opentag', (tag) => {
		if (stack.length === 0) {
			if (sawRoot || tag.name !== 'ListBucketResult')
				throw new Error('Invalid listing root');
			sawRoot = true;
		}
		stack.push(tag.name);
		if (stack.length === 2 && tag.name === 'Contents') {
			contents++;
			contentKeys = 0;
		}
		if (stack.length > 2 && stack[1] !== 'Contents')
			throw new Error('Nested listing field');
		if (stack.length > 5) throw new Error('Listing nesting exceeded');
		text = '';
	});
	parser.on('text', (value) => {
		text += value;
	});
	parser.on('cdata', (value) => {
		text += value;
	});
	parser.on('closetag', () => {
		if (stack.length === 2 && stack[1] !== 'Contents') {
			if (fields.has(stack[1])) throw new Error('Duplicate listing field');
			fields.set(stack[1], text);
		} else if (
			stack.length === 3 &&
			stack[1] === 'Contents' &&
			stack[2] === 'Key'
		) {
			contentKeys++;
			if (contentKeys !== 1) throw new Error('Duplicate object key');
			keys.push(text);
		}
		if (stack.length === 2 && stack[1] === 'Contents' && contentKeys !== 1)
			throw new Error('Missing object key');
		stack.pop();
		text = '';
	});
	parser.on('error', (error) => {
		throw error;
	});
	parser.write(xml).close();
	if (!sawRoot || stack.length || contents !== keys.length)
		throw new Error('Incomplete listing');
	return { keys, fields };
}

export async function readLimited(
	response: Response,
	signal: AbortSignal
): Promise<Buffer> {
	if (!response.body) throw new Error('Missing listing body');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const chunk = await bounded(reader.read(), signal);
			if (chunk.done) break;
			length += chunk.value.byteLength;
			if (length > MAX_BYTES) throw new Error('Listing body exceeded limit');
			chunks.push(chunk.value);
		}
		return Buffer.concat(chunks, length);
	} finally {
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

function firstCheckpoint(
	listing: Listing,
	location: GcsLocation,
	category: Category,
	marker: string
): number | null {
	const prefix = `${location.prefix}${category}/`;
	const { fields, keys } = listing;
	if (
		fields.get('Name') !== location.bucket ||
		fields.get('Prefix') !== prefix ||
		fields.get('Marker') !== marker ||
		fields.get('MaxKeys') !== '2' ||
		!['true', 'false'].includes(fields.get('IsTruncated') ?? '') ||
		fields.has('EncodingType') ||
		keys.length === 0 ||
		keys.length > 2
	)
		return null;
	let previous = marker;
	const checkpoints: number[] = [];
	for (const key of keys) {
		if (!key.startsWith(prefix) || key <= previous) return null;
		const hex = key
			.slice(prefix.length)
			.match(
				/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[a-z]+-([0-9a-f]{8})\.(?:json|xdr\.gz)$/
			)?.[1];
		if (!hex) return null;
		const checkpoint = Number.parseInt(hex, 16);
		if (
			!validCheckpoint(checkpoint) ||
			key !== checkpointKey(location.prefix, category, checkpoint)
		)
			return null;
		checkpoints.push(checkpoint);
		previous = key;
	}
	return checkpoints[0];
}

/** Listing absence is source evidence only, never proof that replacement bytes are valid. */
export async function probeGcsArchiveListingGap(
	input: GcsArchiveListingGapInput,
	dependencies: Partial<GcsArchiveListingGapDependencies> = {}
): Promise<HistoryArchiveListingGapDTO | null> {
	if (
		input.observedHttpStatus !== 404 ||
		!validCheckpoint(input.checkpoint) ||
		input.archiveRoot.length > 2048
	)
		return null;
	const fetcher = dependencies.fetch ?? fetch;
	const now = dependencies.now ?? (() => new Date());
	const resolver = dependencies.resolveCname ?? resolveCname;
	const capabilityCache =
		dependencies.capabilityCache ?? defaultCapabilityCache;
	try {
		const root = new URL(input.archiveRoot);
		const rootPath = root.pathname.replace(/\/+$/, '');
		const expected = new URL(root);
		expected.pathname = `${rootPath}/${checkpointKey('', 'history', input.checkpoint)}`;
		if (new URL(input.failedObjectUrl).href !== expected.href) return null;
		let location = capabilityCache.get(root.href, now().getTime());
		if (location === undefined) {
			location = await locateGcs(
				root,
				resolver,
				AbortSignal.timeout(TIMEOUT_MS)
			);
			capabilityCache.set(root.href, location, now().getTime());
		}
		if (!location) return null;
		const listings: Array<HistoryArchiveListingGapDTO['listings'][number]> = [];
		let missingThroughCheckpoint = MAX_CHECKPOINT;
		for (const category of CATEGORIES) {
			const prefix = `${location.prefix}${category}/`;
			const marker =
				input.checkpoint === 63
					? prefix
					: checkpointKey(location.prefix, category, input.checkpoint - 64);
			const listingUrl = new URL(
				`https://storage.googleapis.com/${location.bucket}`
			);
			listingUrl.searchParams.set('prefix', prefix);
			listingUrl.searchParams.set('marker', marker);
			listingUrl.searchParams.set('max-keys', '2');
			const signal = AbortSignal.timeout(TIMEOUT_MS);
			const response = await bounded(
				fetcher(listingUrl.href, { signal, redirect: 'error' }),
				signal
			);
			if (response.status !== 200) {
				if ([401, 403, 404].includes(response.status))
					capabilityCache.set(root.href, null, now().getTime());
				void response.body?.cancel().catch(() => undefined);
				return null;
			}
			const body = await readLimited(response, signal);
			const listing = parseListing(
				new TextDecoder('utf-8', { fatal: true }).decode(body)
			);
			const firstReturnedCheckpoint = firstCheckpoint(
				listing,
				location,
				category,
				marker
			);
			if (
				firstReturnedCheckpoint === null ||
				firstReturnedCheckpoint <= input.checkpoint
			)
				return null;
			missingThroughCheckpoint = Math.min(
				missingThroughCheckpoint,
				firstReturnedCheckpoint - 64
			);
			if (missingThroughCheckpoint < input.checkpoint + 64) return null;
			listings.push({
				category,
				listingUrl: listingUrl.href,
				responseSha256: createHash('sha256').update(body).digest('hex'),
				firstReturnedKey: listing.keys[0],
				firstReturnedCheckpoint
			});
		}
		return {
			kind: 'gcs-listing-gap',
			archiveRoot: input.archiveRoot,
			missingFromCheckpoint: input.checkpoint,
			missingThroughCheckpoint,
			observedAt: now().toISOString(),
			listings
		};
	} catch {
		// Capability denial, malformed listings and transport errors leave ordinary GET handling unchanged.
		return null;
	}
}
