import type {
	HistoryArchiveRamCandidateFeed,
	HistoryArchiveRamWindowCursor
} from '../../repositories/database/HistoryArchiveRamCandidateFeed.js';
import type { ArchiveBrokerRamCandidate, ArchiveBrokerRamContext } from './ArchiveBrokerRamTypes.js';
import type { ArchiveBrokerRamScheduler } from './ArchiveBrokerRamScheduler.js';
import { ArchiveBrokerRamEligibility, ramStaticEligible, ramTime } from './ArchiveBrokerRamEligibility.js';

type Feed = Pick<HistoryArchiveRamCandidateFeed, 'listRootPage' | 'windowPage'>;
const rootsPerRefill = 8;
const rowsPerPage = 128;

export function workingWindowEligibility(context: ArchiveBrokerRamContext, elapsedMs: number, maximumPriority = 2) {
	const now = ramTime(context.databaseNowUs) + BigInt(Math.max(0, Math.floor(elapsedMs * 1_000)));
	// Canonical priority is enforced when taking/claiming work. Brief canonical
	// catch-up must not evict useful prefetched work belonging to other roots.
	const eligibility = new ArchiveBrokerRamEligibility({ ...context, canonicalRoot: null }, now);
	return (row: ArchiveBrokerRamCandidate): boolean => {
		if (row.priority > maximumPriority || !ramStaticEligible(row) || ramTime(row.availableAtUs) > now) return false;
		const lane = eligibility.lane(row);
		return lane !== null && (!lane.targetRestricted || row.checkpointLedger === lane.target);
	};
}

/** Only a disposable working window. Unread rows, holes, shared dependencies
 * and retries remain durable; stopping prefetch never removes cached work. */
export class ArchiveBrokerRamWindow {
	private rootCursor: string | null = null;
	private readonly cursors = new Map<string, HistoryArchiveRamWindowCursor | null>();
	constructor(
		private readonly feed: Feed,
		private readonly queue: ArchiveBrokerRamScheduler,
		readonly maximumPerRoot: number,
		private readonly canonicalRoot: string | null
	) {}
	reset(): void {
		this.rootCursor = null;
		this.cursors.clear();
	}
	async refill(
		current: () => boolean,
		accept: (row: ArchiveBrokerRamCandidate) => boolean
	): Promise<{ roots: number; rows: number }> {
		let roots = 0, rows = 0;
		if (!current() || this.queue.size >= this.queue.maxRows) return { roots, rows };
		const visit = async (root: string) => {
			if (!current() || this.queue.size >= this.queue.maxRows ||
				this.queue.rootSize(root) >= this.maximumPerRoot) return;
			const before = this.cursors.get(root) ?? null;
			const page = await this.feed.windowPage(root, before, rowsPerPage);
			if (!current()) return;
			roots++;
			rows += page.rows.length;
			let consumed = before;
			for (const row of page.rows) {
				if (!accept(row)) {
					this.remember(root, consumed);
					return;
				}
				consumed = {
					priority: row.priority, updatedAtUs: row.updatedAtUs, remoteId: row.remoteId
				};
			}
			if (page.hasMore && (page.nextCursor === null ||
				JSON.stringify(page.nextCursor) === JSON.stringify(before)))
				throw new Error('Archive working-window cursor did not advance');
			this.remember(root, page.hasMore ? page.nextCursor : null);
		};
		if (this.canonicalRoot !== null) await visit(this.canonicalRoot);
		if (!current() || this.queue.size >= this.queue.maxRows) return { roots, rows };
		const page = await this.feed.listRootPage(this.rootCursor, rootsPerRefill - roots);
		if (!current()) return { roots, rows };
		let completed = true;
		for (const root of page.roots) {
			if (!current() || this.queue.size >= this.queue.maxRows) {
				completed = false;
				break;
			}
			if (root !== this.canonicalRoot) await visit(root);
			if (!current()) return { roots, rows };
			this.rootCursor = root;
		}
		if (completed && !page.hasMore) this.rootCursor = null;
		return { roots, rows };
	}
	private remember(root: string, cursor: HistoryArchiveRamWindowCursor | null): void {
		// One tiny cursor per known root, not per job. Do not evict a root's
		// progress through a filtered prefix when another root is visited.
		this.cursors.set(root, cursor);
	}
}
