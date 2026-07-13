type EffectCleanup = () => void;
type EffectCallback = () => void | EffectCleanup;
type Dependencies = readonly unknown[] | undefined;

interface RefSlot {
	kind: 'ref';
	value: { current: unknown };
}

interface CallbackSlot {
	dependencies: readonly unknown[];
	kind: 'callback';
	value: unknown;
}

interface EffectSlot {
	cleanup: EffectCleanup | undefined;
	dependencies: Dependencies;
	kind: 'effect';
}

type HookSlot = CallbackSlot | EffectSlot | RefSlot;

const dependenciesMatch = (left: Dependencies, right: Dependencies): boolean =>
	left !== undefined &&
	right !== undefined &&
	left.length === right.length &&
	left.every((value, index) => Object.is(value, right[index]));

export class HookHarness {
	private cursor = 0;
	private pendingEffects: Array<{
		effect: EffectCallback;
		slot: EffectSlot;
	}> = [];
	private slots: HookSlot[] = [];

	readonly useCallback = <T>(
		callback: T,
		dependencies: readonly unknown[]
	): T => {
		const index = this.cursor++;
		const current = this.slots[index];
		if (current?.kind === 'callback') {
			if (dependenciesMatch(current.dependencies, dependencies)) {
				return current.value as T;
			}
			current.dependencies = dependencies;
			current.value = callback;
			return callback;
		}
		if (current) throw new Error('Hook order changed');
		this.slots[index] = { dependencies, kind: 'callback', value: callback };
		return callback;
	};

	readonly useEffect = (
		effect: EffectCallback,
		dependencies?: readonly unknown[]
	): void => {
		const index = this.cursor++;
		const current = this.slots[index];
		if (current?.kind === 'effect') {
			if (dependenciesMatch(current.dependencies, dependencies)) return;
			current.dependencies = dependencies;
			this.pendingEffects.push({ effect, slot: current });
			return;
		}
		if (current) throw new Error('Hook order changed');
		const slot: EffectSlot = {
			cleanup: undefined,
			dependencies,
			kind: 'effect'
		};
		this.slots[index] = slot;
		this.pendingEffects.push({ effect, slot });
	};

	readonly useRef = <T>(initialValue: T): { current: T } => {
		const index = this.cursor++;
		const current = this.slots[index];
		if (current?.kind === 'ref') return current.value as { current: T };
		if (current) throw new Error('Hook order changed');
		const value = { current: initialValue };
		this.slots[index] = { kind: 'ref', value };
		return value;
	};

	render<T>(renderHook: () => T): T {
		this.cursor = 0;
		this.pendingEffects = [];
		const result = renderHook();
		const pendingEffects = this.pendingEffects;
		this.pendingEffects = [];
		for (const { effect, slot } of pendingEffects) {
			slot.cleanup?.();
			const cleanup = effect();
			slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
		}
		return result;
	}

	reset(): void {
		for (const slot of this.slots.toReversed()) {
			if (slot.kind === 'effect') slot.cleanup?.();
		}
		this.cursor = 0;
		this.pendingEffects = [];
		this.slots = [];
	}
}

interface ClockTask {
	at: number;
	id: number;
	kind: 'frame' | 'timeout';
	run: () => void;
}

export class TestClock {
	now = 0;
	private nextId = 1;
	private readonly tasks = new Map<number, ClockTask>();

	readonly window = {
		cancelAnimationFrame: (id: number): void => {
			this.tasks.delete(id);
		},
		clearTimeout: (id: number): void => {
			this.tasks.delete(id);
		},
		requestAnimationFrame: (callback: FrameRequestCallback): number =>
			this.schedule('frame', 16, () => callback(this.now)),
		setTimeout: (callback: () => void, delay = 0): number =>
			this.schedule('timeout', delay, callback)
	};

	advanceBy(durationMs: number): void {
		const target = this.now + durationMs;
		let task = this.nextTask(target);
		while (task) {
			this.now = Math.max(this.now, task.at);
			this.tasks.delete(task.id);
			task.run();
			task = this.nextTask(target);
		}
		this.now = target;
	}

	elapseWithoutRunning(durationMs: number): void {
		this.now += durationMs;
	}

	flushDue(): void {
		this.advanceBy(0);
	}

	install(): void {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: this.window
		});
	}

	pendingTimeoutCount(): number {
		return Array.from(this.tasks.values()).filter(
			(task) => task.kind === 'timeout'
		).length;
	}

	private nextTask(target: number): ClockTask | undefined {
		return Array.from(this.tasks.values())
			.filter((task) => task.at <= target)
			.toSorted((left, right) => left.at - right.at || left.id - right.id)[0];
	}

	private schedule(
		kind: ClockTask['kind'],
		delay: number,
		run: () => void
	): number {
		const id = this.nextId++;
		this.tasks.set(id, {
			at: this.now + Math.max(0, delay),
			id,
			kind,
			run
		});
		return id;
	}
}
