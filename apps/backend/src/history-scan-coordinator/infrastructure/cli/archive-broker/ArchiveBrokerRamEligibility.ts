import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext,
	ArchiveBrokerRamControl
} from './ArchiveBrokerRamTypes.js';

export function ramTime(value: string): bigint {
	if (!/^-?\d+$/.test(value))
		throw new Error('Invalid RAM scheduling microsecond timestamp');
	return BigInt(value);
}
export const ramCompare = (
	a: number | bigint | string,
	b: number | bigint | string
): number => (a < b ? -1 : a > b ? 1 : 0);
export const ramCheckpointCompare = (
	a: number | null,
	b: number | null
): number => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b);
export function ramTimestamp(value: bigint): string {
	const seconds =
		value >= 0n ? value / 1_000_000n : (value - 999_999n) / 1_000_000n;
	const fraction = value - seconds * 1_000_000n;
	return new Date(Number(seconds * 1_000n))
		.toISOString()
		.replace('.000Z', `.${fraction.toString().padStart(6, '0')}Z`);
}
export function ramStaticEligible(row: ArchiveBrokerRamCandidate): boolean {
	return (
		row.dispatchToken !== null ||
		(row.executionDisposition === 'executable' &&
			row.dependencyReady &&
			(row.transitionEffectsRequiredAtUs === null ||
				row.transitionEffectsCompletedAtUs !== null))
	);
}
export interface RamLaneAdmission {
	readonly controlScope: string | null;
	readonly targetRestricted: boolean;
	readonly target: number | null;
}
/** Small per-refill control/host snapshot. No per-candidate SQL or whole-cache walk. */
export class ArchiveBrokerRamEligibility {
	readonly activeHosts = new Map<string, number>();
	readonly rootRanks = new Map<string, number>();
	private readonly controls = new Map<string, ArchiveBrokerRamControl[]>();
	private readonly busyScopes = new Map<string, Set<string>>();
	private readonly throttles = new Map<string, bigint>();
	private readonly excludedHosts: Set<string>;
	private readonly excludedRoots: Set<string>;
	constructor(
		private readonly context: ArchiveBrokerRamContext,
		private readonly now: bigint
	) {
		for (const host of context.activeHosts)
			this.activeHosts.set(host.hostIdentity, host.activeCount);
		for (const root of context.rootSortRanks)
			this.rootRanks.set(root.archiveUrlIdentity, root.sortRank);
		for (const control of context.controls) {
			const list = this.controls.get(control.archiveUrlIdentity) ?? [];
			list.push(control);
			this.controls.set(control.archiveUrlIdentity, list);
		}
		for (const active of context.activeScopes)
			if (active.published > 0 || active.scanning > 0) {
				const set =
					this.busyScopes.get(active.archiveUrlIdentity) ?? new Set<string>();
				set.add(active.objectType);
				this.busyScopes.set(active.archiveUrlIdentity, set);
			}
		for (const host of context.hostThrottles)
			this.throttles.set(host.hostIdentity, ramTime(host.blockedUntilUs));
		this.excludedHosts = new Set(context.excludedHosts);
		this.excludedRoots = new Set(context.excludedRoots);
	}
	lane(row: ArchiveBrokerRamCandidate): RamLaneAdmission | null {
		if (
			this.excludedHosts.has(row.hostIdentity) ||
			this.excludedRoots.has(row.archiveUrlIdentity)
		)
			return null;
		if ((this.throttles.get(row.hostIdentity) ?? this.now) > this.now)
			return null;
		if (
			row.dispatchToken === null &&
			this.context.canonicalRoot !== null &&
			this.context.canonicalIncomplete &&
			row.archiveUrlIdentity !== this.context.canonicalRoot
		)
			return null;
		let controlScope: string | null = null,
			targetRestricted = false,
			target: number | null = null;
		for (const control of this.controls.get(row.archiveUrlIdentity) ?? []) {
			if (control.scope !== '*' && control.scope !== row.objectType) continue;
			if (
				(control.blockedUntilUs !== null &&
					ramTime(control.blockedUntilUs) > this.now) ||
				(control.probeLeaseUntilUs !== null &&
					ramTime(control.probeLeaseUntilUs) > this.now)
			)
				return null;
			if (control.unknownCount > 0) {
				if (targetRestricted && target !== control.nextProbeCheckpoint)
					return null;
				targetRestricted = true;
				target = control.nextProbeCheckpoint;
			}
			if (control.blockedUntilUs !== null || control.unknownCount > 0) {
				const busy = this.busyScopes.get(row.archiveUrlIdentity);
				if (
					busy &&
					(control.scope === '*' ? busy.size > 0 : busy.has(control.scope))
				)
					return null;
				if (controlScope === null || control.scope < controlScope)
					controlScope = control.scope;
			}
		}
		return { controlScope, targetRestricted, target };
	}
}
