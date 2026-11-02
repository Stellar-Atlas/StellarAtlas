type EffectCleanup = () => void;
type HookSlot =
	| { kind: 'state'; value: unknown }
	| { kind: 'ref'; value: { current: unknown } }
	| {
			kind: 'effect';
			dependencies: readonly unknown[] | undefined;
			cleanup?: EffectCleanup;
	  };

export class HookHarness {
	private slots: HookSlot[] = [];
	private cursor = 0;
	private pendingEffects: Array<{
		index: number;
		callback: () => void | EffectCleanup;
	}> = [];

	readonly useState = <T,>(
		initial: T | (() => T)
	): [T, (next: T | ((current: T) => T)) => void] => {
		const index = this.cursor++;
		let slot = this.slots[index];
		if (!slot) {
			this.slots[index] = {
				kind: 'state',
				value: typeof initial === 'function' ? (initial as () => T)() : initial
			};
			slot = this.slots[index];
		}
		if (slot.kind !== 'state') throw new Error('Hook order changed');
		return [
			slot.value as T,
			(next) => {
				const current = this.slots[index];
				if (current?.kind !== 'state') throw new Error('State hook missing');
				current.value =
					typeof next === 'function'
						? (next as (value: T) => T)(current.value as T)
						: next;
			}
		];
	};

	readonly useRef = <T,>(initial: T): { current: T } => {
		const index = this.cursor++;
		let slot = this.slots[index];
		if (!slot) {
			this.slots[index] = { kind: 'ref', value: { current: initial } };
			slot = this.slots[index];
		}
		if (slot.kind !== 'ref') throw new Error('Hook order changed');
		return slot.value as { current: T };
	};

	readonly useEffect = (
		callback: () => void | EffectCleanup,
		dependencies?: readonly unknown[]
	): void => {
		const index = this.cursor++;
		const slot = this.slots[index];
		if (!slot) {
			this.slots[index] = { kind: 'effect', dependencies };
			this.pendingEffects.push({ index, callback });
			return;
		}
		if (slot.kind !== 'effect') throw new Error('Hook order changed');
		const same =
			dependencies !== undefined &&
			slot.dependencies !== undefined &&
			dependencies.length === slot.dependencies.length &&
			dependencies.every((value, position) =>
				Object.is(value, slot.dependencies?.[position])
			);
		if (!same) {
			slot.cleanup?.();
			slot.dependencies = dependencies;
			this.pendingEffects.push({ index, callback });
		}
	};

	readonly useMemo = <T,>(compute: () => T, dependencies?: readonly unknown[]): T => {
		const cache = this.useRef<{ dependencies: readonly unknown[] | undefined; value: T } | null>(null);
		const previous = cache.current;
		if (dependencies && previous?.dependencies && dependencies.length === previous.dependencies.length &&
			dependencies.every((value, index) => Object.is(value, previous.dependencies?.[index]))) return previous.value;
		const value = compute();
		cache.current = { dependencies, value };
		return value;
	};

	reset(): void {
		for (const slot of this.slots) slot.kind === 'effect' && slot.cleanup?.();
		this.slots = [];
		this.cursor = 0;
		this.pendingEffects = [];
	}

	render<T>(renderComponent: () => T): T {
		this.cursor = 0;
		this.pendingEffects = [];
		const result = renderComponent();
		for (const { index, callback } of this.pendingEffects) {
			const slot = this.slots[index];
			if (slot?.kind !== 'effect') throw new Error('Effect hook missing');
			slot.cleanup = callback() || undefined;
		}
		return result;
	}
}
