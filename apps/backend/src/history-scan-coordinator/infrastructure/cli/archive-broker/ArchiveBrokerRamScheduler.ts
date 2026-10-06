import { ArchiveBrokerIndexedHeap } from './ArchiveBrokerIndexedHeap.js';
import {
	ArchiveBrokerRamEligibility,
	ramCheckpointCompare,
	ramCompare,
	ramStaticEligible,
	ramTime,
	ramTimestamp
} from './ArchiveBrokerRamEligibility.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamSelected,
	ArchiveBrokerRamTakeOptions
} from './ArchiveBrokerRamTypes.js';

interface Entry {
	readonly remoteId: string;
	readonly row: ArchiveBrokerRamCandidate;
	readonly available: bigint;
	readonly updated: bigint;
	lane: Lane | null;
	active: boolean;
}
const order = (a: Entry, b: Entry): number =>
	ramCheckpointCompare(a.row.checkpointLedger, b.row.checkpointLedger) ||
	a.row.objectOrder - b.row.objectOrder ||
	ramCompare(a.updated, b.updated) ||
	ramCompare(a.remoteId, b.remoteId);
const age = (a: Entry, b: Entry): number =>
	ramCompare(a.updated, b.updated) || ramCompare(a.remoteId, b.remoteId);
const probe = (a: Pick, b: Pick): number =>
	a.entry.row.priority - b.entry.row.priority ||
	ramCheckpointCompare(
		a.entry.row.checkpointLedger,
		b.entry.row.checkpointLedger
	) ||
	a.entry.row.objectOrder - b.entry.row.objectOrder ||
	ramCompare(a.entry.remoteId, b.entry.remoteId);
const key = (...parts: readonly (string | number | boolean)[]): string =>
	JSON.stringify(parts);
class Lane {
	readonly ordered = new ArchiveBrokerIndexedHeap(order);
	readonly ages = new ArchiveBrokerIndexedHeap(age);
	readonly points = new Map<number, ArchiveBrokerIndexedHeap<Entry>>();
	constructor(readonly key: string) {}
	point(point: number, limit: number): readonly Entry[] {
		return this.points.get(point)?.first(limit) ?? [];
	}
}
interface Pick {
	entry: Entry;
	controlScope: string | null;
	firstAge: bigint | null;
	rootReady: bigint;
	rootRound: number;
	rootRank: number;
	activeCount: number;
	hostRank: number;
}
const ranked = (a: Pick, b: Pick): number =>
	a.entry.row.priority - b.entry.row.priority ||
	a.rootRound - b.rootRound ||
	ramCompare(a.rootReady, b.rootReady) ||
	a.rootRank - b.rootRank ||
	ramCompare(a.entry.remoteId, b.entry.remoteId);

/** A rebuildable first-pass read model. take() never consumes a durable claim.
 * Root/category/priority heaps avoid a global candidate walk on capacity wakes.
 * Published/attempted records and evidence payloads never enter these queues. */
export class ArchiveBrokerRamScheduler {
	private readonly entries = new Map<string, Entry>();
	private readonly lanes = new Map<string, Lane>();
	private readonly rootCounts = new Map<string, number>();
	private readonly future = new ArchiveBrokerIndexedHeap<Entry>(
		(a, b) =>
			ramCompare(a.available, b.available) || ramCompare(a.remoteId, b.remoteId)
	);
	private now: bigint | null = null;
	private examined = 0;
	private selected = 0;
	private clockRebuilds = 0;
	constructor(readonly maxRows = 1_000_000) {
		if (!Number.isSafeInteger(maxRows) || maxRows < 1)
			throw new Error('Invalid RAM scheduling row ceiling');
	}
	get size(): number {
		return this.entries.size;
	}
	roots(): readonly string[] {
		return [...this.rootCounts.keys()];
	}
	get metrics() {
		return {
			rows: this.size,
			lanes: this.lanes.size,
			roots: this.rootCounts.size,
			future: this.future.size,
			maxRows: this.maxRows,
			examinedLastTake: this.examined,
			selectedLastTake: this.selected,
			clockRebuilds: this.clockRebuilds
		};
	}
	clear(): void {
		this.entries.clear();
		this.lanes.clear();
		this.rootCounts.clear();
		this.future.clear();
		this.now = null;
		this.examined = 0;
		this.selected = 0;
	}
	/** Last upsert wins; deletion precedes upsert, matching snapshot/ID refreshes. */
	apply(
		rows: readonly ArchiveBrokerRamCandidate[],
		deletedIds: readonly string[] = []
	): void {
		const updates = new Map<string, Entry | null>();
		for (const id of deletedIds) updates.set(id, null);
		for (const row of rows) {
			if (
				row.status !== 'pending' ||
				row.attempts !== 0 ||
				row.publishedAtUs !== null
			) {
				updates.set(row.remoteId, null);
				continue;
			}
			if (
				![0, 1, 2].includes(row.priority) ||
				!Number.isSafeInteger(row.objectOrder) ||
				(row.checkpointLedger !== null &&
					!Number.isSafeInteger(row.checkpointLedger))
			)
				throw new Error('Invalid RAM candidate ordering fields');
			updates.set(row.remoteId, {
				remoteId: row.remoteId,
				row,
				available: ramTime(row.availableAtUs),
				updated: ramTime(row.updatedAtUs),
				lane: null,
				active: false
			});
		}
		let count = this.size;
		for (const [id, value] of updates)
			count += Number(value !== null) - Number(this.entries.has(id));
		if (count > this.maxRows) {
			this.clear();
			throw new Error(
				`RAM scheduling ceiling exceeded (${count} > ${this.maxRows}); full reconciliation required`
			);
		}
		for (const [id, entry] of updates) {
			this.remove([id]);
			if (!entry) continue;
			this.entries.set(id, entry);
			this.rootCounts.set(
				entry.row.archiveUrlIdentity,
				(this.rootCounts.get(entry.row.archiveUrlIdentity) ?? 0) + 1
			);
			if (this.now !== null) this.schedule(entry);
		}
	}
	remove(ids: readonly string[]): void {
		for (const id of ids) {
			const entry = this.entries.get(id);
			if (!entry) continue;
			this.detach(entry);
			this.future.remove(id);
			this.entries.delete(id);
			const root = entry.row.archiveUrlIdentity,
				count = this.rootCounts.get(root)! - 1;
			if (count === 0) this.rootCounts.delete(root);
			else this.rootCounts.set(root, count);
		}
	}
	private schedule(entry: Entry): void {
		if (!ramStaticEligible(entry.row)) return;
		if (entry.available > this.now!) {
			this.future.upsert(entry);
			return;
		}
		const row = entry.row;
		const laneKey = key(
			row.archiveUrlIdentity,
			row.objectType,
			row.priority,
			row.hostIdentity,
			row.dispatchToken !== null,
			row.checkpointLedger === null
		);
		let lane = this.lanes.get(laneKey);
		if (!lane) {
			lane = new Lane(laneKey);
			this.lanes.set(laneKey, lane);
		}
		lane.ordered.upsert(entry);
		lane.ages.upsert(entry);
		if (row.checkpointLedger !== null) {
			let point = lane.points.get(row.checkpointLedger);
			if (!point) {
				point = new ArchiveBrokerIndexedHeap(order);
				lane.points.set(row.checkpointLedger, point);
			}
			point.upsert(entry);
		}
		entry.lane = lane;
		entry.active = true;
	}
	private detach(entry: Entry): void {
		const lane = entry.lane;
		if (!lane) return;
		lane.ordered.remove(entry.remoteId);
		lane.ages.remove(entry.remoteId);
		if (entry.row.checkpointLedger !== null) {
			const point = lane.points.get(entry.row.checkpointLedger);
			point?.remove(entry.remoteId);
			if (point?.size === 0) lane.points.delete(entry.row.checkpointLedger);
		}
		if (lane.ordered.size === 0) this.lanes.delete(lane.key);
		entry.lane = null;
		entry.active = false;
	}
	private advance(now: bigint): void {
		if (this.now === null || now < this.now) {
			if (this.now !== null) this.clockRebuilds++;
			this.lanes.clear();
			this.future.clear();
			this.now = now;
			for (const entry of this.entries.values()) {
				entry.lane = null;
				entry.active = false;
				this.schedule(entry);
			}
			return;
		}
		this.now = now;
		while (this.future.peek() && this.future.peek()!.available <= now)
			this.schedule(this.future.pop()!);
	}
	take(
		options: ArchiveBrokerRamTakeOptions
	): readonly ArchiveBrokerRamSelected[] {
		const limit = Math.floor(options.limit),
			cap = Math.floor(options.maximumPerHost);
		this.examined = 0;
		this.selected = 0;
		if (limit < 1 || cap < 1) return [];
		this.advance(ramTime(options.nowUs ?? options.context.databaseNowUs));
		const eligibility = new ArchiveBrokerRamEligibility(
			options.context,
			this.now!
		);
		const ages = new Map<string, bigint>();
		const categories = new Map<string, Pick[]>();
		const prefix = Math.min(limit, cap);
		for (const lane of this.lanes.values()) {
			const first = lane.ordered.peek()!;
			if (first.row.priority > options.maximumPriority) continue;
			const admission = eligibility.lane(first.row);
			if (!admission) continue;
			const rootRank = eligibility.rootRanks.get(first.row.archiveUrlIdentity);
			if (rootRank === undefined)
				throw new Error(
					'RAM root collation rank missing; context refresh required'
				);
			const ageKey = key(first.row.archiveUrlIdentity, first.row.priority);
			if (admission.controlScope === null) {
				const oldest = lane.ages.peek()!.updated;
				if (!ages.has(ageKey) || oldest < ages.get(ageKey)!)
					ages.set(ageKey, oldest);
			}
			let candidates: readonly Entry[];
			if (admission.targetRestricted) {
				if (admission.target === null)
					candidates =
						first.row.checkpointLedger === null
							? lane.ordered.first(prefix)
							: [];
				else candidates = lane.point(admission.target, prefix);
			} else candidates = lane.ordered.first(prefix);
			this.examined += candidates.length;
			const categoryKey = key(
				first.row.archiveUrlIdentity,
				first.row.priority,
				first.row.objectType,
				first.row.checkpointLedger === null
			);
			const group = categories.get(categoryKey) ?? [];
			for (const entry of candidates)
				group.push({
					entry,
					controlScope: admission.controlScope,
					firstAge: null,
					rootReady: 0n,
					rootRound: 0,
					rootRank,
					activeCount: eligibility.activeHosts.get(entry.row.hostIdentity) ?? 0,
					hostRank: 0
				});
			categories.set(categoryKey, group);
		}
		const probes = new Map<string, Pick>(),
			eligible: Pick[] = [];
		for (const candidates of categories.values())
			for (const candidate of candidates
				.sort((a, b) => order(a.entry, b.entry))
				.slice(0, prefix)) {
				if (candidate.controlScope === null) {
					eligible.push(candidate);
					continue;
				}
				const probeKey = key(
					candidate.entry.row.archiveUrlIdentity,
					candidate.controlScope
				);
				const previous = probes.get(probeKey);
				if (!previous || probe(candidate, previous) < 0)
					probes.set(probeKey, candidate);
			}
		eligible.push(...probes.values());
		const roots = new Map<string, Pick[]>();
		for (const candidate of eligible) {
			const rootKey = key(
				candidate.entry.row.archiveUrlIdentity,
				candidate.entry.row.priority
			);
			candidate.firstAge =
				candidate.controlScope === null ? ages.get(rootKey)! : null;
			const group = roots.get(rootKey) ?? [];
			group.push(candidate);
			roots.set(rootKey, group);
		}
		for (const group of roots.values()) {
			group.sort((a, b) => order(a.entry, b.entry));
			let oldest = group[0]!.firstAge ?? group[0]!.entry.updated;
			for (const candidate of group) {
				const age = candidate.firstAge ?? candidate.entry.updated;
				if (age < oldest) oldest = age;
			}
			group.forEach((candidate, index) => {
				candidate.rootReady = oldest;
				candidate.rootRound = index + 1;
			});
		}
		const hostRanks = new Map<string, number>();
		const admitted = eligible.sort(ranked).filter((candidate) => {
			const host = candidate.entry.row.hostIdentity;
			candidate.hostRank = (hostRanks.get(host) ?? 0) + 1;
			hostRanks.set(host, candidate.hostRank);
			return candidate.activeCount + candidate.hostRank <= cap;
		});
		admitted.sort(
			(a, b) =>
				a.entry.row.priority - b.entry.row.priority ||
				a.rootRound - b.rootRound ||
				ramCompare(a.rootReady, b.rootReady) ||
				a.activeCount - b.activeCount ||
				a.rootRank - b.rootRank ||
				a.hostRank - b.hostRank ||
				ramCompare(a.entry.remoteId, b.entry.remoteId)
		);
		const result = admitted
			.slice(0, limit)
			.map((candidate, index) => ({
				remoteId: candidate.entry.remoteId,
				selectedOrdinal: index + 1,
				firstPassRootReadyAt:
					candidate.firstAge === null ? null : ramTimestamp(candidate.firstAge)
			}));
		this.selected = result.length;
		return result;
	}
}
