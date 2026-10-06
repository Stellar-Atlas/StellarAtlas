import type { EntityManager } from 'typeorm';
import type { HistoryArchiveContentReuseV1 } from 'shared';
import type { PreparedContentCompletion } from './HistoryArchiveContentReuseWrite.js';
import {
	contentFactsForStorage,
	type HistoryArchiveCompactContentFacts
} from './HistoryArchiveCompactContentFacts.js';

interface Template {
	readonly identity: string;
	readonly categoryKey: string;
	readonly serialized: string;
	readonly fullBytesWithoutSourceUrl: number;
	readonly bytes: number;
}

export interface CompactTemplateHit {
	readonly categoryKey: string;
	readonly serialized: string;
	readonly fullBytesWithoutSourceUrl: number;
}

// Only server-derived compact facts are retained, never XDR arrays or active
// claim decisions. Each DataSource owns a separate bounded process-local cache.
// The database must still validate the immutable identity and original source
// observation on EVERY hit; deleting/restoring a database requires a new source.
export class HistoryArchiveCompactTemplateCache {
	private readonly entries = new Map<string, Template>();
	private retainedBytes = 0;
	constructor(
		private readonly maximumBytes = 8 * 1024 * 1024,
		private readonly maximumEntries = 4096
	) {}

	get size(): number {
		return this.entries.size;
	}
	get byteLength(): number {
		return this.retainedBytes;
	}

	get(
		reuse: HistoryArchiveContentReuseV1,
		claimAttempt: number
	): CompactTemplateHit | undefined {
		const entry = this.entries.get(reuse.artifactId);
		if (entry === undefined) return undefined;
		if (entry.identity !== identity(reuse)) {
			this.delete(reuse.artifactId);
			return undefined;
		}
		// The URL occurs once in both representations, so using an empty URL
		// preserves the exact byte comparison for any subsequent target root.
		const compact = bindCompactTemplate(entry, '', claimAttempt);
		if (
			Buffer.byteLength(JSON.stringify(compact), 'utf8') >=
			entry.fullBytesWithoutSourceUrl + 2
		)
			return undefined;
		this.entries.delete(reuse.artifactId);
		this.entries.set(reuse.artifactId, entry);
		return entry;
	}

	put(prepared: PreparedContentCompletion): void {
		if (prepared.reuse === null || prepared.storageFacts !== undefined) return;
		const facts = prepared.progress.verificationFacts;
		const compact = contentFactsForStorage(prepared, true);
		if (facts == null || compact == null || !('contentReference' in compact))
			return;
		const categoryKey = [
			'ledgerCategory',
			'transactionsCategory',
			'resultsCategory'
		].find((key) => key in compact);
		if (categoryKey === undefined) return;
		const category = compact[categoryKey] as Readonly<Record<string, unknown>>;
		if (typeof category.sourceUrl !== 'string') return;
		const normalized = {
			...compact,
			contentReference: { ...compact.contentReference, claimAttempt: 0 },
			[categoryKey]: { ...category, sourceUrl: '' }
		};
		const serialized = JSON.stringify(normalized);
		const entryIdentity = identity(prepared.reuse);
		const bytes = Buffer.byteLength(serialized + entryIdentity, 'utf8');
		if (
			bytes > Math.min(this.maximumBytes, 64 * 1024) ||
			this.maximumEntries < 1
		)
			return;
		this.delete(prepared.reuse.artifactId);
		while (
			this.entries.size >= this.maximumEntries ||
			this.retainedBytes + bytes > this.maximumBytes
		) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) return;
			this.delete(oldest);
		}
		this.entries.set(prepared.reuse.artifactId, {
			identity: entryIdentity,
			categoryKey,
			serialized,
			bytes,
			fullBytesWithoutSourceUrl:
				Buffer.byteLength(JSON.stringify(facts), 'utf8') -
				Buffer.byteLength(JSON.stringify(category.sourceUrl), 'utf8')
		});
		this.retainedBytes += bytes;
	}

	delete(artifactId: string): void {
		const entry = this.entries.get(artifactId);
		if (entry === undefined) return;
		this.retainedBytes -= entry.bytes;
		this.entries.delete(artifactId);
	}
}

const caches = new WeakMap<object, HistoryArchiveCompactTemplateCache>();
export function compactTemplateCache(
	manager: EntityManager
): HistoryArchiveCompactTemplateCache {
	let cache = caches.get(manager.connection);
	if (cache === undefined) {
		cache = new HistoryArchiveCompactTemplateCache();
		caches.set(manager.connection, cache);
	}
	return cache;
}

export function bindCompactTemplate(
	template: CompactTemplateHit,
	sourceUrl: string,
	claimAttempt: number
): HistoryArchiveCompactContentFacts {
	// The serialized value was produced by contentFactsForStorage, not supplied
	// by a worker. Parsing a small copy prevents callers mutating the cache.
	const compact = JSON.parse(
		template.serialized
	) as HistoryArchiveCompactContentFacts;
	const category = compact[template.categoryKey] as Readonly<
		Record<string, unknown>
	>;
	return {
		...compact,
		contentReference: { ...compact.contentReference, claimAttempt },
		[template.categoryKey]: { ...category, sourceUrl }
	};
}

function identity(reuse: HistoryArchiveContentReuseV1): string {
	return JSON.stringify([
		reuse.artifactId,
		reuse.sourceObjectRemoteId,
		reuse.contentDigest,
		reuse.contentRepresentation,
		reuse.derivationVersion
	]);
}
