import type { Logger } from 'logger';
import { ArchiveBrokerRamScheduler } from './ArchiveBrokerRamScheduler.js';
import type {
	ArchiveBrokerRamContext,
	ArchiveBrokerRamSelected
} from './ArchiveBrokerRamTypes.js';
import type { HistoryArchiveRamCandidateFeed } from '../../repositories/database/HistoryArchiveRamCandidateFeed.js';
import type { HistoryArchiveBrokerJob } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';

type Feed = Pick<
	HistoryArchiveRamCandidateFeed,
	'snapshotPage' | 'refreshIds' | 'loadContext'
>;
type Claim = (
	ids: readonly ArchiveBrokerRamSelected[],
	root: string | null
) => Promise<readonly HistoryArchiveBrokerJob[]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reconciliationIntervalMs = 15 * 60_000;

/** Scheduling metadata is disposable. Claims/evidence remain transactionally
 * fenced in PostgreSQL; a missed notification can delay work, never authorize it. */
export class ArchiveBrokerRamDispatch {
	private queue: ArchiveBrokerRamScheduler;
	private readonly dirty = new Set<string>();
	private rebuildingDirty: Set<string> | null = null;
	private rebuild: Promise<void> | null = null;
	private generation = 0;
	private connected = false;
	private ready = false;
	private stopped = false;
	private context: ArchiveBrokerRamContext | null = null;
	private contextDirty = true;
	private contextVersion = 0;
	private contextTime = 0;
	private nextRebuildAt = 0;
	private nextFallbackAt = 0;
	private nextReportAt = 0;
	private claimedSinceReport = 0;
	private readonly maximumRows: number;
	constructor(
		private readonly feed: Feed,
		private readonly claim: Claim,
		private readonly config: HistoryArchiveBrokerConfig,
		private readonly logger: Logger,
		private readonly wake: () => void,
		private readonly clock: () => number = () => performance.now()
	) {
		this.maximumRows = config.ramMaximumRows ?? 1_000_000;
		this.queue = new ArchiveBrokerRamScheduler(this.maximumRows);
	}
	setConnected(connected: boolean): void {
		if (this.stopped) return;
		this.connected = connected;
		this.invalidate();
		if (connected) this.ensureRebuild();
	}
	notify(payload: unknown): void {
		if (this.stopped) return;
		if (typeof payload !== 'object' || payload === null) {
			this.reset();
			return;
		}
		if ('reset' in payload && payload.reset === true) {
			this.reset();
			return;
		}
		this.markContextDirty();
		if ('ids' in payload) {
			if (
				!Array.isArray(payload.ids) ||
				payload.ids.length > 128 ||
				!payload.ids.every(
					(id: unknown) => typeof id === 'string' && uuid.test(id)
				)
			) {
				this.reset();
				return;
			}
			this.invalidateIds(payload.ids as string[]);
		} else if (!('context' in payload && payload.context === true))
			this.reset();
	}
	private markContextDirty(): void {
		this.contextDirty = true;
		this.contextVersion++;
	}
	private invalidateIds(ids: readonly string[]): void {
		for (const id of ids) {
			this.dirty.add(id.toLowerCase());
			this.rebuildingDirty?.add(id.toLowerCase());
		}
		if (
			this.dirty.size > this.maximumRows ||
			(this.rebuildingDirty?.size ?? 0) > this.maximumRows
		)
			this.reset(); // Explicit rebuild; never silently lose invalidations.
	}
	private invalidate(): void {
		this.generation++;
		this.ready = false;
		this.queue.clear();
		this.dirty.clear();
		this.rebuildingDirty = null;
		this.context = null;
		this.markContextDirty();
		this.nextRebuildAt = 0;
	}
	private reset(): void {
		this.invalidate();
		this.ensureRebuild();
	}
	private ensureRebuild(): void {
		if (
			this.stopped ||
			!this.connected ||
			this.rebuild !== null ||
			this.clock() < this.nextRebuildAt
		)
			return;
		this.nextRebuildAt = this.clock() + reconciliationIntervalMs;
		this.rebuild = this.buildSnapshot()
			.catch((error) => {
				this.nextRebuildAt = this.clock() + 60_000;
				this.logger.error(
					'Archive RAM scheduling rebuild deferred; durable fallback retained',
					{
						errorMessage: error instanceof Error ? error.message : String(error)
					}
				);
			})
			.finally(() => {
				this.rebuild = null;
				this.rebuildingDirty = null;
				if (!this.stopped) this.wake();
			});
	}
	private async buildSnapshot(): Promise<void> {
		const generation = this.generation;
		const changed = new Set<string>();
		this.rebuildingDirty = changed;
		const queue = new ArchiveBrokerRamScheduler(this.maximumRows);
		const started = this.clock();
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page = await this.feed.snapshotPage(cursor, 512);
			if (!this.valid(generation)) return;
			queue.apply(page.rows, []);
			pages++;
			if (!page.hasMore) break;
			if (page.nextCursor === null || page.nextCursor === cursor)
				throw new Error('Archive RAM snapshot cursor did not advance');
			cursor = page.nextCursor;
		} while (true);
		// Every committed change since LISTEN was installed is replayed AFTER
		// keyset pagination. Concurrent changes cannot fall between snapshot pages.
		while (changed.size > 0) {
			await this.refresh(queue, changed, 128);
			if (!this.valid(generation)) return;
		}
		if (!this.valid(generation)) return;
		this.queue = queue;
		this.dirty.clear();
		this.context = null;
		this.markContextDirty();
		this.ready = true;
		this.logger.info('Archive RAM scheduling snapshot ready', {
			candidates: queue.size,
			pages,
			elapsedMs: Math.round(this.clock() - started)
		});
	}
	private valid(generation: number): boolean {
		return !this.stopped && this.connected && this.generation === generation;
	}
	private async refresh(
		queue: ArchiveBrokerRamScheduler,
		dirty: Set<string>,
		limit: number
	): Promise<void> {
		const ids: string[] = [];
		for (const id of dirty) {
			ids.push(id);
			if (ids.length === limit) break;
		}
		if (ids.length === 0) return;
		// Remove BEFORE awaiting so an update arriving during the query survives.
		for (const id of ids) dirty.delete(id);
		try {
			queue.apply(await this.feed.refreshIds(ids), ids);
			if (queue === this.queue) this.markContextDirty();
		} catch (error) {
			for (const id of ids) dirty.add(id);
			throw error;
		}
	}
	/** null asks the caller to use the existing durable recovery selector. */
	async reserve(
		limit: number,
		root: string | null
	): Promise<readonly HistoryArchiveBrokerJob[] | null> {
		this.ensureRebuild();
		if (!this.ready || !this.connected)
			return this.fallback(Math.max(1_000, this.config.pollIntervalMs));
		const generation = this.generation;
		try {
			for (let batch = 0; this.dirty.size > 0 && batch < 16; batch++)
				await this.refresh(this.queue, this.dirty, 128);
			if (!this.valid(generation) || !this.ready) return null;
			if (
				this.contextDirty ||
				this.context === null ||
				this.context.canonicalRoot !== root ||
				this.clock() - this.contextTime >= 1_000
			) {
				const version = this.contextVersion;
				const beforeQuery = this.clock();
				this.context = await this.feed.loadContext(root, this.queue.roots());
				this.contextTime = beforeQuery;
				this.contextDirty = version !== this.contextVersion;
			}
			if (!this.valid(generation) || this.context === null) return null;
			const nowUs = (
				BigInt(this.context.databaseNowUs) +
				BigInt(
					Math.max(0, Math.floor((this.clock() - this.contextTime) * 1_000))
				)
			).toString();
			const selected = this.queue.take({
				limit,
				maximumPerHost: this.config.maximumPerHost,
				maximumPriority: this.config.maximumPriority,
				context: this.context,
				nowUs
			});
			// Preserve the old selector's ability to fill spare capacity with an
			// explicitly allowed recovery/manual job alongside a trickle of fresh work.
			if (selected.length < limit && this.clock() >= this.nextFallbackAt)
				return this.fallback(15_000);
			if (selected.length === 0) {
				// Recovery/manual lanes keep their original authoritative policy, but
				// capacity messages must not turn empty RAM into repeated global scans.
				return this.fallback(15_000);
			}
			const ids = selected.map((row) => row.remoteId);
			this.invalidateIds(ids);
			const jobs = await this.claim(selected, root);
			this.queue.remove(jobs.map((job) => job.job.remoteId));
			this.markContextDirty();
			this.claimedSinceReport += jobs.length;
			if (this.clock() >= this.nextReportAt) {
				this.logger.info('Archive RAM scheduling active', {
					...this.queue.metrics,
					dirtyIds: this.dirty.size,
					claimedSinceReport: this.claimedSinceReport
				});
				this.nextReportAt = this.clock() + 30_000;
				this.claimedSinceReport = 0;
			}
			return jobs;
		} catch (error) {
			// A malformed/overflowing mirror must not strand the durable work.
			this.invalidate();
			this.nextRebuildAt = this.clock() + 60_000;
			this.logger.error(
				'Archive RAM scheduling unavailable; using durable fallback',
				{
					errorMessage: error instanceof Error ? error.message : String(error)
				}
			);
			return null;
		}
	}
	private fallback(
		interval: number
	): null | readonly HistoryArchiveBrokerJob[] {
		if (this.clock() < this.nextFallbackAt) return [];
		this.nextFallbackAt = this.clock() + interval;
		return null;
	}
	async close(): Promise<void> {
		this.stopped = true;
		this.invalidate();
		await this.rebuild;
	}
}
