import type { Logger } from 'logger';
import { ArchiveBrokerRamScheduler } from './ArchiveBrokerRamScheduler.js';
import { ArchiveBrokerRamWindow, workingWindowEligibility } from './ArchiveBrokerRamWindow.js';
import type {
	ArchiveBrokerRamContext,
	ArchiveBrokerRamSelected
} from './ArchiveBrokerRamTypes.js';
import type { HistoryArchiveRamCandidateFeed } from '../../repositories/database/HistoryArchiveRamCandidateFeed.js';
import type { HistoryArchiveBrokerJob } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';

type Feed = Pick<
	HistoryArchiveRamCandidateFeed,
	'listRootPage' | 'windowPage' | 'refreshIds' | 'loadContext'
>;
type Claim = (
	ids: readonly ArchiveBrokerRamSelected[],
	root: string | null,
	fallbackObjectIds: readonly string[]
) => Promise<readonly HistoryArchiveBrokerJob[]>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const broaderCapacityFallbackIntervalMs = 15_000;

/** Scheduling metadata is disposable. Claims/evidence remain transactionally
 * fenced in PostgreSQL; a missed notification can delay work, never authorize it. */
export class ArchiveBrokerRamDispatch {
	private queue: ArchiveBrokerRamScheduler;
	private readonly window: ArchiveBrokerRamWindow;
	private refillHintsOverflowed = false;
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
	private residualFallbackOwed = false;
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
		this.maximumRows = Math.min(config.ramMaximumRows ?? 16_384, 16_384);
		this.queue = new ArchiveBrokerRamScheduler(this.maximumRows);
		this.window = new ArchiveBrokerRamWindow(
			feed, this.queue, Math.min(128, Math.max(8, config.maximumPerHost * 2)),
			config.canonicalFirstRoot
		);
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
		) {
			// Unknown hints can be rediscovered from durable ready rows. Exact
			// refresh of the bounded retained set protects every cached identity.
			this.dirty.clear();
			for (const id of this.queue.ids()) this.dirty.add(id);
			this.rebuildingDirty?.clear();
			this.refillHintsOverflowed = true;
			this.nextRebuildAt = 0;
		}
	}
	private invalidate(): void {
		this.generation++;
		this.ready = false;
		this.queue.clear();
		this.window.reset();
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
	private deferRebuild(): void {
		// A failed prefetch must not discard useful, transactionally fenced work.
		this.nextRebuildAt = this.clock() + 60_000;
	}
	private ensureRebuild(): void {
		const now = this.clock();
		if (
			this.stopped ||
			!this.connected ||
			this.rebuild !== null ||
			now < this.nextRebuildAt
		)
			return;
		this.nextRebuildAt = now + Math.max(250, Math.min(2_000, this.config.pollIntervalMs));
		const generation = this.generation;
		const activeMirror = this.queue;
		const stillBuilding = () => this.valid(generation) && this.queue === activeMirror;
		this.rebuild = this.refillWindow(stillBuilding)
			.catch((error) => {
				if (!stillBuilding()) return;
				this.deferRebuild();
				this.logger.error(
					'Archive working-window refill deferred; cached work retained',
					{
						errorMessage: error instanceof Error ? error.message : String(error)
					}
				);
			})
			.finally(() => {
				this.rebuild = null;
				this.rebuildingDirty = null;
				this.refillHintsOverflowed = false;
				if (!this.stopped) this.wake();
			});
	}
	private async refillWindow(stillBuilding: () => boolean): Promise<void> {
		const changed = new Set<string>();
		this.rebuildingDirty = changed;
		const started = this.clock();
		const cached = this.context;
		const reuse = cached !== null && started - this.contextTime < 1_000;
		const context = reuse ? cached : await this.feed.loadContext(
			this.config.canonicalFirstRoot, this.queue.roots()
		);
		if (!stillBuilding()) return;
		const eligible = workingWindowEligibility(
			context, this.clock() - (reuse ? this.contextTime : started), this.config.maximumPriority
		);
		this.queue.pruneWindow(eligible);
		const result = await this.window.refill(stillBuilding, (row) => {
			if (this.refillHintsOverflowed) return false;
			if (changed.has(row.remoteId)) return true;
			if (!eligible(row)) {
				this.queue.remove([row.remoteId]);
				return true;
			}
			return this.queue.applyWindowRow(row, this.window.maximumPerRoot);
		});
		if (!stillBuilding()) return;
		// Do not let a concurrent exact refresh be overwritten by an older page.
		for (const id of changed) this.dirty.add(id);
		const initial = !this.ready;
		if (initial || result.roots > 0) {
			this.context = null;
			this.markContextDirty();
		}
		this.ready = true;
		if (initial) this.logger.info('Archive bounded working window ready', {
			candidates: this.queue.size, maximumRows: this.maximumRows,
			maximumPerRoot: this.window.maximumPerRoot, ...result,
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
			queue.remove(ids);
			for (const row of rows)
				queue.applyWindowRow(row, this.window.maximumPerRoot);
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
		if (this.residualFallbackOwed) {
			this.residualFallbackOwed = false;
			return this.fallback(15_000);
		}
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
			const rankedRoots = new Set(this.context.rootSortRanks.map((row) => row.archiveUrlIdentity));
			if (mirror.roots().some((root) => !rankedRoots.has(root))) {
				// A bounded background refill may add a root during loadContext.
				// Retry the context, not a sixty-second cache-error backoff.
				this.markContextDirty();
				return this.fallback(Math.max(1_000, this.config.pollIntervalMs));
			}
			mirror.pruneWindow(workingWindowEligibility(
				this.context, this.clock() - this.contextTime, this.config.maximumPriority
			));
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
			const residualFallbackDue = selected.length < limit &&
				this.clock() >= this.nextFallbackAt;
			if (selected.length === 0) {
				// Recovery/manual lanes keep their original authoritative policy, but
				// capacity messages must not turn empty RAM into repeated global scans.
				const broader = this.broaderCapacityFallback(root, afterEmptyCanonicalDurable);
				return broader === undefined ? this.fallback(15_000) : broader;
			}
			const ids = selected.map((row) => row.remoteId);
			const fallbackObjectIds = this.context.fallbackObjectIds;
			this.invalidateIds(ids);
			if (!stillCurrent()) return [];
			durableClaimStarted = true;
			const jobs = await this.claim(selected, root, fallbackObjectIds);
			// Publish useful partial work first. The next capacity-bearing loop
			// still gives recovery/manual work its existing durable opportunity.
			if (jobs.length > 0 && residualFallbackDue && !this.stopped)
				this.residualFallbackOwed = true;
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
			this.deferRebuild();
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
	isCapacityFallbackActive(): boolean {
		return !this.stopped && this.clock() < this.nextFallbackAt;
	}
	recordBroaderFallbackResult(count: number): void {
		const now = this.clock();
		if (count > 0 && !this.stopped)
			this.nextBroaderCapacityFallbackAt = Math.min(
				this.nextBroaderCapacityFallbackAt,
				now + Math.max(1_000, this.config.pollIntervalMs)
			);
	}
	private broaderCapacityFallback(
		root: string | null,
		afterEmptyCanonicalDurable: boolean
	): null | readonly HistoryArchiveBrokerJob[] | undefined {
		const now = this.clock();
		if (root !== null || this.config.canonicalFirstRoot == null)
			return undefined;
		// A slow scoped query or refill must not reopen the broader throttle.
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
