/** Sparse observations never establish absence of an interval. These ranges are unknown. */
export interface AdaptiveProbeRange {
	readonly from: number;
	readonly through: number;
}

export interface AdaptiveProbeState {
	readonly version: 1;
	readonly through: number;
	readonly unknown: readonly AdaptiveProbeRange[];
	readonly pending: {
		readonly checkpoint: number;
		readonly remoteId: string;
	} | null;
}

export const maximumAdaptiveProbeRanges = 64;
export const maximumArchiveCheckpoint = 2_147_483_583;

export function isAdaptiveCheckpoint(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 63 &&
		value <= maximumArchiveCheckpoint &&
		value % 64 === 63
	);
}

export function parseAdaptiveProbeState(
	value: unknown
): AdaptiveProbeState | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('version' in value) ||
		value.version !== 1 ||
		!('through' in value) ||
		!isAdaptiveCheckpoint(value.through) ||
		!('unknown' in value) ||
		!Array.isArray(value.unknown) ||
		value.unknown.length > maximumAdaptiveProbeRanges ||
		!('pending' in value)
	)
		return null;
	let previous = -1;
	for (const range of value.unknown as unknown[]) {
		if (
			typeof range !== 'object' ||
			range === null ||
			!('from' in range) ||
			!('through' in range) ||
			!isAdaptiveCheckpoint(range.from) ||
			!isAdaptiveCheckpoint(range.through) ||
			range.from > range.through ||
			range.from <= previous ||
			range.through > value.through
		)
			return null;
		previous = range.through;
	}
	const pending = value.pending;
	if (
		pending !== null &&
		(typeof pending !== 'object' ||
			!('checkpoint' in pending) ||
			!isAdaptiveCheckpoint(pending.checkpoint) ||
			!('remoteId' in pending) ||
			typeof pending.remoteId !== 'string' ||
			!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
				pending.remoteId
			))
	)
		return null;
	const state = value as AdaptiveProbeState;
	if (
		state.pending !== null &&
		!state.unknown.some(
			(range) =>
				state.pending!.checkpoint >= range.from &&
				state.pending!.checkpoint <= range.through
		)
	)
		return null;
	return state;
}

/** Adjacent distinct positions, not retries/completion ordering, trigger discovery. */
export function createAdaptiveProbeState(
	missing: readonly number[],
	latest: number
): AdaptiveProbeState | null {
	if (!isAdaptiveCheckpoint(latest)) return null;
	const positions = [...new Set(missing.filter(isAdaptiveCheckpoint))].sort(
		(a, b) => a - b
	);
	const start = positions.find(
		(position) =>
			positions.includes(position + 64) && positions.includes(position + 128)
	);
	if (start === undefined || start + 192 > latest) return null;
	return {
		version: 1,
		through: latest,
		unknown: [{ from: start + 192, through: latest }],
		pending: null
	};
}

/** Upper boundary first; then balanced refinement. At the cap consume an endpoint,
 * rather than discard intervals or let persisted state grow without a bound. */
export function nextAdaptiveProbeCheckpoint(
	state: AdaptiveProbeState
): number | null {
	if (state.pending !== null) return state.pending.checkpoint;
	if (state.unknown.length === 0) return null;
	const largest = state.unknown.reduce((left, right) =>
		right.through - right.from > left.through - left.from ? right : left
	);
	if (state.unknown.length === 1 && largest.through === state.through)
		return largest.through;
	if (state.unknown.length >= maximumAdaptiveProbeRanges) return largest.from;
	return largest.from + 64 * Math.floor((largest.through - largest.from) / 128);
}

/** Remove only the actual terminal sample, irrespective of success/missing outcome.
 * Transport/auth failures are NOT terminal samples and must not call this function. */
export function completeAdaptiveProbe(
	state: AdaptiveProbeState
): AdaptiveProbeState {
	if (state.pending === null) return state;
	const checkpoint = state.pending.checkpoint;
	const unknown = state.unknown.flatMap((range) => {
		if (checkpoint < range.from || checkpoint > range.through) return [range];
		return [
			...(range.from < checkpoint
				? [{ from: range.from, through: checkpoint - 64 }]
				: []),
			...(checkpoint < range.through
				? [{ from: checkpoint + 64, through: range.through }]
				: [])
		];
	});
	return { ...state, unknown, pending: null };
}

export function extendAdaptiveProbeState(
	state: AdaptiveProbeState,
	latest: number
): AdaptiveProbeState {
	if (!isAdaptiveCheckpoint(latest) || latest <= state.through) return state;
	if (state.pending !== null) return state;
	// Do not exceed the state cap while an existing point is in flight.
	if (state.unknown.length >= maximumAdaptiveProbeRanges) return state;
	return {
		...state,
		through: latest,
		unknown: [...state.unknown, { from: state.through + 64, through: latest }]
	};
}
