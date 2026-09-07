import type { DataSource } from 'typeorm';
import type { KnownArchiveFailureSummaryV1 } from 'shared';
import { queryKnownArchiveFailureSummary } from './KnownArchiveFailureSummaryQuery.js';

interface Entry {
	value?: KnownArchiveFailureSummaryV1;
	inFlight?: Promise<KnownArchiveFailureSummaryV1>;
	expiresAt: number;
}

export const unavailableArchiveFailureSummary: KnownArchiveFailureSummaryV1 = {
	status: 'unavailable',
	computedAt: null,
	groups: [],
	limit: 20,
	totalGroups: null,
	remainingGroupCount: null,
	remainingFailureCount: null,
	remoteFailureCount: null,
	workerIssueCount: null
};

export class KnownArchiveFailureSummaryCache {
	private readonly entries = new Map<string, Entry>();
	constructor(
		private readonly load: (
			root: string
		) => Promise<KnownArchiveFailureSummaryV1>,
		private readonly now: () => number = Date.now,
		private readonly maxRoots = 128
	) {}

	get(root: string): Promise<KnownArchiveFailureSummaryV1> {
		let entry = this.entries.get(root);
		if (entry !== undefined) {
			this.entries.delete(root);
			this.entries.set(root, entry);
			if (entry.inFlight !== undefined) return entry.inFlight;
			if (entry.value !== undefined && entry.expiresAt > this.now())
				return Promise.resolve(entry.value);
		} else {
			if (this.entries.size >= this.maxRoots) {
				const evictable = [...this.entries].find(
					([, candidate]) => candidate.inFlight === undefined
				);
				if (evictable === undefined)
					return Promise.resolve(unavailableArchiveFailureSummary);
				this.entries.delete(evictable[0]);
			}
			entry = { expiresAt: 0 };
			this.entries.set(root, entry);
		}
		const current = entry;
		current.inFlight = Promise.resolve()
			.then(() => this.load(root))
			.then((value) => {
				current.value = value;
				current.expiresAt = this.now() + 300_000;
				return value;
			})
			.catch(() => {
				current.value =
					current.value?.computedAt == null
						? unavailableArchiveFailureSummary
						: { ...current.value, status: 'stale' };
				current.expiresAt = this.now() + 15_000;
				return current.value;
			})
			.finally(() => {
				delete current.inFlight;
			});
		return current.inFlight;
	}
}

// Repositories are request-scoped; the bounded cache must live per process/data source.
const caches = new WeakMap<DataSource, KnownArchiveFailureSummaryCache>();
export function getKnownArchiveFailureSummary(
	dataSource: DataSource,
	root: string
): Promise<KnownArchiveFailureSummaryV1> {
	let cache = caches.get(dataSource);
	if (cache === undefined) {
		cache = new KnownArchiveFailureSummaryCache((identity) =>
			queryKnownArchiveFailureSummary(dataSource, identity)
		);
		caches.set(dataSource, cache);
	}
	return cache.get(root);
}
