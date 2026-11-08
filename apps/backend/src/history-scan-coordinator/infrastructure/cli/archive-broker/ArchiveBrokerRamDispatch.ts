import type { Logger } from 'logger';
import {
	ArchiveBrokerRamCapacityError,
	ArchiveBrokerRamScheduler
} from './ArchiveBrokerRamScheduler.js';
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
	root: string | null,
	fallbackObjectIds: readonly string[]
) => Promise<readonly HistoryArchiveBrokerJob[]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reconciliationIntervalMs = 15 * 60_000;
const capacityRetryIntervalMs = 15 * 60_000;
const broaderCapacityFallbackIntervalMs = 15_000;

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
	// An oversized mirror will not fit after a notification reset or reconnect.
	private capacityHoldUntil = 0;
	private nextFallbackAt = 0;
	private nextBroaderCapacityFallbackAt = 0;
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
	private deferRebuild(error: unknown, discardMirror: boolean): void {
		const overflow = error instanceof ArchiveBrokerRamCapacityError;
		if (overflow || discardMirror) this.invalidate();
		if (overflow) this.capacityHoldUntil = this.clock() + capacityRetryIntervalMs;
		else this.nextRebuildAt = this.clock() + 60_000;
	}
	private ensureRebuild(): void {
		const now = this.clock();
		if (
			this.stopped ||
			!this.connected ||
			this.rebuild !== null ||
			now < this.nextRebuildAt ||
			now < this.capacityHoldUntil
		)
			return;
		this.nextRebuildAt = now + reconciliationIntervalMs;
		const generation = this.generation;
		const activeMirror = this.queue;
		const stillBuilding = () => this.valid(generation) && this.queue === activeMirror;
		this.rebuild = this.buildSnapshot(stillBuilding)
			.catch((error) => {
				if (!stillBuilding()) return;
				this.deferRebuild(error, false);
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
	private async buildSnapshot(stillBuilding: () => boolean): Promise<void> {
		const changed = new Set<string>();
		this.rebuildingDirty = changed;
		const queue = new ArchiveBrokerRamScheduler(this.maximumRows);
		const started = this.clock();
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page = await this.feed.snapshotPage(cursor, 512);
			if (!stillBuilding()) return;
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
			await this.refresh(queue, changed, 128, stillBuilding);
			if (!stillBuilding()) return;
		}
		if (!stillBuilding()) return;
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
		limit: number,
		stillCurrent: () => boolean
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
			const rows = await this.feed.refreshIds(ids);
			if (!stillCurrent()) return;
			queue.apply(rows, ids);
			if (queue === this.queue) this.markContextDirty();
		} catch (error) {
			if (stillCurrent()) for (const id of ids) dirty.add(id);
			throw error;
		}
	}
	/** null asks the caller to use the existing durable recovery selector. */
	async reserve(
		limit: number,
		root: string | null,
		afterEmptyCanonicalDurable = false
	): Promise<readonly HistoryArchiveBrokerJob[] | null> {
		if (this.stopped) return [];
		this.ensureRebuild();
		if (!this.ready || !this.connected) {
			const broader = this.broaderCapacityFallback(root, afterEmptyCanonicalDurable);
			if (broader !== undefined) return broader;
			return this.fallback(Math.max(1_000, this.config.pollIntervalMs));
		}
		const generation = this.generation;
		const mirror = this.queue;
		const stillCurrent = () => this.valid(generation) && this.ready && this.queue === mirror;
		let durableClaimStarted = false;
		try {
			for (let batch = 0; stillCurrent() && this.dirty.size > 0 && batch < 16; batch++)
				await this.refresh(mirror, this.dirty, 128, stillCurrent);
			if (!stillCurrent()) return [];
			if (
				this.contextDirty ||
				this.context === null ||
				this.context.canonicalRoot !== root ||
				this.clock() - this.contextTime >= 1_000
			) {
				const version = this.contextVersion;
				const beforeQuery = this.clock();
				const context = await this.feed.loadContext(root, mirror.roots());
				if (!stillCurrent()) return [];
				this.context = context;
				this.contextTime = beforeQuery;
				this.contextDirty = version !== this.contextVersion;
			}
			if (!stillCurrent() || this.context === null) return [];
			const nowUs = (
				BigInt(this.context.databaseNowUs) +
				BigInt(
					Math.max(0, Math.floor((this.clock() - this.contextTime) * 1_000))
				)
			).toString();
			const selected = mirror.take({
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
			const fallbackObjectIds = this.context.fallbackObjectIds;
			this.invalidateIds(ids);
			if (!stillCurrent()) return [];
			durableClaimStarted = true;
			const jobs = await this.claim(selected, root, fallbackObjectIds);
			// A durable claim must be returned even if its in-memory mirror was
			// replaced while the database was committing it.
			if (!stillCurrent()) return jobs;
			mirror.remove(jobs.map((job) => job.job.remoteId));
			this.markContextDirty();
			this.claimedSinceReport += jobs.length;
			if (this.clock() >= this.nextReportAt) {
				this.logger.info('Archive RAM scheduling active', {
					...mirror.metrics,
					dirtyIds: this.dirty.size,
					claimedSinceReport: this.claimedSinceReport
				});
				this.nextReportAt = this.clock() + 30_000;
				this.claimedSinceReport = 0;
			}
			return jobs;
		} catch (error) {
			// Losing the claim result after it started can leave an uncertain commit.
			// A stopped generation cannot turn that uncertainty into a clean drain.
			if (durableClaimStarted && this.stopped) throw error;
			if (!stillCurrent()) return [];
			// A malformed/overflowing mirror must not strand the durable work.
			this.deferRebuild(error, true);
			this.logger.error(
				'Archive RAM scheduling unavailable; using durable fallback',
				{
					errorMessage: error instanceof Error ? error.message : String(error)
				}
			);
			const broader = this.broaderCapacityFallback(root, afterEmptyCanonicalDurable);
			return broader === undefined ? null : broader;
		}
	}
	private broaderCapacityFallback(
		root: string | null,
		afterEmptyCanonicalDurable: boolean
	): null | readonly HistoryArchiveBrokerJob[] | undefined {
		const now = this.clock();
		if (root !== null || this.config.canonicalFirstRoot == null || now >= this.capacityHoldUntil)
			return undefined;
		// This branch is exclusive during the hold: a slow scoped query or
		// prefetch must not reopen the regular fallback throttle for broader work.
		if (this.stopped || !afterEmptyCanonicalDurable || now < this.nextBroaderCapacityFallbackAt)
			return [];
		this.nextBroaderCapacityFallbackAt = now + broaderCapacityFallbackIntervalMs;
		return null;
	}
	private fallback(
		interval: number
	): null | readonly HistoryArchiveBrokerJob[] {
		if (this.clock() < this.nextFallbackAt) return [];
		this.nextFallbackAt = this.clock() + interval;
		return null;
	}
	/** Stop new RAM work without discarding the result of a durable claim in flight. */
	stopAdmission(): void {
		this.stopped = true;
	}
	async close(): Promise<void> {
		this.stopAdmission();
		this.invalidate();
		await this.rebuild;
	}
}
