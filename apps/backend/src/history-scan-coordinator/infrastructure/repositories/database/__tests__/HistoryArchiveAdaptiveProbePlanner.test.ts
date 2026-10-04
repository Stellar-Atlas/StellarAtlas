import {
	completeAdaptiveProbe,
	createAdaptiveProbeState,
	extendAdaptiveProbeState,
	nextAdaptiveProbeCheckpoint,
	parseAdaptiveProbeState,
	maximumAdaptiveProbeRanges,
	type AdaptiveProbeState
} from '../HistoryArchiveAdaptiveProbePlanner.js';

const id = '00000000-0000-4000-8000-000000000001';
function sample(state: AdaptiveProbeState): AdaptiveProbeState {
	const checkpoint = nextAdaptiveProbeCheckpoint(state)!;
	return completeAdaptiveProbe({
		...state,
		pending: { checkpoint, remoteId: id }
	});
}

describe('adaptive missing checkpoint planner', () => {
	it('requires three adjacent distinct aligned misses, independent of completion order', () => {
		expect(createAdaptiveProbeState([63, 63, 63], 639)).toBeNull();
		expect(createAdaptiveProbeState([63, 191, 319], 639)).toBeNull();
		expect(createAdaptiveProbeState([191, 63, 127], 639)?.unknown).toEqual([
			{ from: 255, through: 639 }
		]);
		expect(createAdaptiveProbeState([64, 128, 192], 639)).toBeNull();
		expect(createAdaptiveProbeState([63, 127, 191], 191)).toBeNull();
	});
	it('samples upper boundary then midpoint, retaining both unknown sides', () => {
		let state = createAdaptiveProbeState([63, 127, 191], 1279)!;
		expect(nextAdaptiveProbeCheckpoint(state)).toBe(1279);
		state = sample(state);
		expect(state.unknown).toEqual([{ from: 255, through: 1215 }]);
		expect(nextAdaptiveProbeCheckpoint(state)).toBe(703);
		state = sample(state);
		expect(state.unknown).toEqual([
			{ from: 255, through: 639 },
			{ from: 767, through: 1215 }
		]);
	});
	it('finite refinement visits every point exactly once, including noncontiguous islands', () => {
		let state = createAdaptiveProbeState([63, 127, 191], 65535)!;
		const visited = new Set<number>();
		const islands = new Set([255, 1087, 4095, 30399, 65535]);
		while (state.unknown.length > 0) {
			const checkpoint = nextAdaptiveProbeCheckpoint(state)!;
			expect(checkpoint % 64).toBe(63);
			expect(visited.has(checkpoint)).toBe(false);
			visited.add(checkpoint);
			state = sample(state); // Both present and missing consume only this point.
			expect(state.unknown.length).toBeLessThanOrEqual(
				maximumAdaptiveProbeRanges
			);
		}
		expect(visited.size).toBe((65535 - 255) / 64 + 1);
		for (const island of islands) expect(visited.has(island)).toBe(true);
	});
	it('persists a pending sample without resampling on restart and rejects corrupt intervals', () => {
		const initial = createAdaptiveProbeState([63, 127, 191], 639)!;
		const state = { ...initial, pending: { checkpoint: 639, remoteId: id } };
		expect(parseAdaptiveProbeState(JSON.parse(JSON.stringify(state)))).toEqual(
			state
		);
		expect(nextAdaptiveProbeCheckpoint(state)).toBe(639);
		expect(
			parseAdaptiveProbeState({
				...state,
				pending: { checkpoint: 127, remoteId: id }
			})
		).toBeNull();
		expect(
			parseAdaptiveProbeState({
				...state,
				unknown: [{ from: 255, through: 300 }]
			})
		).toBeNull();
	});
	it('adds a newly authorized tail without forgetting old unknown intervals', () => {
		const state = sample(createAdaptiveProbeState([63, 127, 191], 639)!);
		expect(extendAdaptiveProbeState(state, 767).unknown).toEqual([
			{ from: 255, through: 575 },
			{ from: 703, through: 767 }
		]);
		expect(extendAdaptiveProbeState(state, 700)).toBe(state);
	});
});
