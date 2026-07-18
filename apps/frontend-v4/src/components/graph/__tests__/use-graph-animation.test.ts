import type { ForceGraph3DInstance } from '3d-force-graph';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { PublicNode, PublicScpGraphStatement } from '../../../api/types';
import type { ActiveWave } from '../graph-wave-animation';
import { defaultGraphVisualState } from '../graph-visual-state';
import type { Graph3DNode } from '../model-3d';
import type { LedgerPlaybackFrame } from '../scp-flow-paths';
import { HookHarness, TestClock } from './graph-animation-test-harness';

type GraphAnimationHook =
	(typeof import('../use-graph-animation'))['useGraphAnimation'];
type GraphAnimationOptions = Parameters<GraphAnimationHook>[0];
const jest = import.meta.jest;
const esmJest = jest as typeof jest & {
	unstable_mockModule: (
		moduleName: string,
		moduleFactory: () => Record<string, unknown>
	) => void;
};

const hookHarness = new HookHarness();
esmJest.unstable_mockModule('react', () => ({
	useCallback: hookHarness.useCallback,
	useEffect: hookHarness.useEffect,
	useRef: hookHarness.useRef
}));

let clock: TestClock;
let useGraphAnimation: GraphAnimationHook;

beforeAll(async () => {
	({ useGraphAnimation } = await import('../use-graph-animation'));
});

beforeEach(() => {
	hookHarness.reset();
	clock = new TestClock();
	clock.install();
	jest.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	hookHarness.reset();
	jest.restoreAllMocks();
	Reflect.deleteProperty(globalThis, 'window');
});

describe('graph ledger playback pause and resume', () => {
	it('freezes the active ledger and retains queued work across feed updates', () => {
		const firstLedger = createLedger('101');
		const secondLedger = createLedger('102');
		const playbackSlots: Array<string | null> = [];
		let options = createOptions({
			boundarySlotIndex: '103',
			ledgers: [firstLedger, secondLedger],
			playbackSlots
		});
		const render = (): void => {
			hookHarness.render(() => useGraphAnimation(options));
		};

		render();
		expect(playbackSlots).toEqual(['101']);
		expect(clock.pendingTimeoutCount()).toBe(1);
		clock.advanceBy(1_000);

		options = { ...options, animationsEnabled: false };
		render();
		expect(playbackSlots.at(-1)).toBe('101');
		expect(playbackSlots).not.toContain(null);
		expect(clock.pendingTimeoutCount()).toBe(0);

		options = {
			...options,
			playbackBoundarySlotIndex: '105',
			playbackLedgers: [createLedger('103'), createLedger('104')]
		};
		render();
		clock.advanceBy(10_000);
		expect(playbackSlots).toEqual(['101']);

		options = { ...options, animationsEnabled: true };
		render();
		expect(clock.pendingTimeoutCount()).toBe(1);
		options = { ...options, animationsEnabled: false };
		render();
		expect(clock.pendingTimeoutCount()).toBe(0);
		options = { ...options, animationsEnabled: true };
		render();
		expect(clock.pendingTimeoutCount()).toBe(1);

		clock.advanceBy(3_999);
		expect(playbackSlots.at(-1)).toBe('101');
		clock.advanceBy(1);
		expect(playbackSlots.at(-1)).toBe('103');
	});

	it('drops late statement timers at the ledger budget and deregisters them', () => {
		const node = createGraphNode();
		const activeHashSnapshots: string[][] = [];
		const ledger = createLedger('201', 2, {
			animationBudgetMs: 1_000,
			playbackDurationMs: 5_000
		});
		const options = createOptions({
			activeHashSnapshots,
			boundarySlotIndex: '202',
			ledgers: [ledger],
			nodes: [node]
		});

		hookHarness.render(() => useGraphAnimation(options));
		expect(options.animationTimeoutsRef.current).toHaveLength(2);
		clock.flushDue();
		expect(activeHashSnapshots.at(-1)).toEqual(['statement-201-0']);
		expect(options.animationTimeoutsRef.current).toHaveLength(1);

		clock.elapseWithoutRunning(1_001);
		clock.flushDue();
		expect(activeHashSnapshots.at(-1)).toEqual(['statement-201-0']);
		expect(options.animationTimeoutsRef.current).toHaveLength(0);

		clock.elapseWithoutRunning(700);
		clock.flushDue();
		expect(options.activityTimeoutsRef.current).toHaveLength(0);
		expect(activeHashSnapshots.at(-1)).toEqual([]);
	});

	it('replaces stale queued ledgers with the newest live window while playing', () => {
		const playbackSlots: Array<string | null> = [];
		let options = createOptions({
			boundarySlotIndex: '103',
			ledgers: [createLedger('101'), createLedger('102')],
			playbackSlots
		});
		const render = (): void => {
			hookHarness.render(() => useGraphAnimation(options));
		};

		render();
		expect(playbackSlots).toEqual(['101']);

		options = {
			...options,
			playbackBoundarySlotIndex: '114',
			playbackLedgers: ['110', '111', '112', '113'].map((slotIndex) =>
				createLedger(slotIndex)
			)
		};
		render();
		clock.advanceBy(5_000);

		expect(playbackSlots.at(-1)).toBe('110');
		expect(playbackSlots).not.toContain('102');
	});

	it('never rewinds when a later feed update contains older or changed slots', () => {
		const playbackSlots: Array<string | null> = [];
		let options = createOptions({
			boundarySlotIndex: '113',
			ledgers: [createLedger('110'), createLedger('111'), createLedger('112')],
			playbackSlots
		});
		const render = (): void => {
			hookHarness.render(() => useGraphAnimation(options));
		};

		render();
		expect(playbackSlots).toEqual(['110']);

		options = {
			...options,
			playbackBoundarySlotIndex: '114',
			playbackLedgers: [
				createLedger('97', 2),
				createLedger('109', 2),
				createLedger('110', 2),
				createLedger('111'),
				createLedger('112'),
				createLedger('113')
			]
		};
		render();
		clock.advanceBy(5_000);

		expect(playbackSlots.at(-1)).toBe('111');
		expect(playbackSlots).not.toContain('97');
		expect(playbackSlots).not.toContain('109');
		expect(playbackSlots.filter((slot) => slot === '110')).toHaveLength(1);
	});

	it('clears a queued window when pausing before the renderer can start it', () => {
		const playbackSlots: Array<string | null> = [];
		let options = createOptions({
			boundarySlotIndex: '103',
			ledgers: [createLedger('101'), createLedger('102')],
			playbackSlots
		});
		options.graphRef.current = null;
		const render = (): void => {
			hookHarness.render(() => useGraphAnimation(options));
		};

		render();
		expect(playbackSlots).toEqual([]);
		options = { ...options, animationsEnabled: false };
		render();

		options.graphRef.current = createForceGraph();
		options = {
			...options,
			animationsEnabled: true,
			playbackBoundarySlotIndex: '105',
			playbackLedgers: [createLedger('103'), createLedger('104')]
		};
		render();

		expect(playbackSlots).toEqual(['103']);
		expect(playbackSlots).not.toContain('101');
		expect(playbackSlots).not.toContain('102');
	});

	it('refills the bounded queue until more than one hundred ledgers play', () => {
		const playbackSlots: Array<string | null> = [];
		const slotIndexes = Array.from({ length: 105 }, (_, index) =>
			(1_000 + index).toString()
		);
		const options = createOptions({
			boundarySlotIndex: '1105',
			ledgers: slotIndexes.map((slotIndex) => createLedger(slotIndex)),
			playbackSlots
		});

		hookHarness.render(() => useGraphAnimation(options));
		clock.advanceBy(slotIndexes.length * 5_000);

		expect(
			playbackSlots.filter((slot): slot is string => slot !== null)
		).toEqual(slotIndexes);
	});
});

function createOptions({
	activeHashSnapshots = [],
	boundarySlotIndex,
	ledgers,
	nodes = [],
	playbackSlots = []
}: {
	activeHashSnapshots?: string[][];
	boundarySlotIndex: string;
	ledgers: readonly LedgerPlaybackFrame[];
	nodes?: readonly Graph3DNode[];
	playbackSlots?: Array<string | null>;
}): GraphAnimationOptions {
	let activePlaybackSlotIndex: string | null = null;
	let activeStatementHashes: ReadonlySet<string> = new Set<string>();
	const setActivePlaybackSlotIndex: Dispatch<SetStateAction<string | null>> = (
		action
	) => {
		activePlaybackSlotIndex =
			typeof action === 'function' ? action(activePlaybackSlotIndex) : action;
		playbackSlots.push(activePlaybackSlotIndex);
	};
	const setActiveStatementHashes: Dispatch<
		SetStateAction<ReadonlySet<string>>
	> = (action) => {
		activeStatementHashes =
			typeof action === 'function' ? action(activeStatementHashes) : action;
		activeHashSnapshots.push(Array.from(activeStatementHashes).toSorted());
	};
	const nodesById = new Map(nodes.map((node) => [node.id, node]));

	return {
		activeWavesRef: ref(new Map<number, ActiveWave>()),
		activityTimeoutsRef: ref<number[]>([]),
		animatedStatementHashesRef: ref(new Set<string>()),
		animationTimeoutsRef: ref<number[]>([]),
		animationsEnabled: true,
		animationsEnabledRef: ref(true),
		graphRef: ref(createForceGraph()),
		nextWaveIndexRef: ref(0),
		nodeActivityRef: ref(new Map<string, number>()),
		nodesByIdRef: ref(nodesById),
		organizationByNodeId: new Map(
			nodes.map((node) => [node.id, node.node.organizationId])
		),
		playbackBoundarySlotIndex: boundarySlotIndex,
		playbackLedgers: ledgers,
		refreshGraphVisuals: jest.fn(),
		setActivePlaybackSlotIndex,
		setActiveStatementHashes,
		threeRef: ref<typeof import('three') | null>(null),
		visualStateRef: ref({ ...defaultGraphVisualState }),
		waveAnimationFrameRef: ref<number | null>(null),
		wavePoolRef: ref(null)
	};
}

function createForceGraph(): ForceGraph3DInstance {
	return {
		pauseAnimation: jest.fn(),
		refresh: jest.fn(),
		resumeAnimation: jest.fn()
	} as unknown as ForceGraph3DInstance;
}

function createLedger(
	slotIndex: string,
	statementCount = 1,
	overrides: Pick<
		LedgerPlaybackFrame,
		'animationBudgetMs' | 'playbackDurationMs'
	> = {}
): LedgerPlaybackFrame {
	return {
		...overrides,
		slotIndex,
		statements: Array.from({ length: statementCount }, (_, index) =>
			createStatement(slotIndex, index)
		)
	};
}

const nodeId = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function createStatement(
	slotIndex: string,
	index: number
): PublicScpGraphStatement {
	return {
		nodeId,
		observedAt: `2026-07-13T00:00:0${index}.000Z`,
		observedFromPeer: nodeId,
		quorumSetHash: 'quorum-test',
		slotIndex,
		statementHash: `statement-${slotIndex}-${index}`,
		statementType: index === 0 ? 'nominate' : 'prepare',
		values: []
	};
}

function createGraphNode(): Graph3DNode {
	const node: PublicNode = {
		active: true,
		activeInScp: true,
		alias: null,
		connectivityError: false,
		dateDiscovered: '2026-07-13T00:00:00.000Z',
		dateUpdated: '2026-07-13T00:00:00.000Z',
		geoData: null,
		historyArchiveHasError: false,
		historyUrl: null,
		homeDomain: null,
		host: null,
		index: 1,
		ip: '127.0.0.1',
		isFullValidator: true,
		isValidating: true,
		isValidator: true,
		isp: null,
		lag: 0,
		ledgerVersion: 27,
		name: 'Test validator',
		organizationId: null,
		overLoaded: false,
		overlayMinVersion: 36,
		overlayVersion: 36,
		port: 11625,
		publicKey: nodeId,
		quorumSet: null,
		quorumSetHashKey: null,
		statistics: {
			active24HoursPercentage: 100,
			active30DaysPercentage: 100,
			has24HourStats: true,
			has30DayStats: true,
			overLoaded24HoursPercentage: 0,
			overLoaded30DaysPercentage: 0,
			validating24HoursPercentage: 100,
			validating30DaysPercentage: 100
		},
		stellarCoreVersionBehind: false,
		versionStr: 'test'
	};
	return {
		color: '#58a6ff',
		detail: nodeId,
		groupId: 'test',
		groupName: 'Test',
		id: nodeId,
		isInTransitiveQuorumSet: true,
		kind: 'validator',
		node,
		size: 8,
		x: 0,
		y: 0,
		z: 0
	};
}

function ref<T>(current: T): RefObject<T> {
	return { current };
}
