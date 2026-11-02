import { jest } from '@jest/globals';

type EffectCleanup = () => void;
type HookSlot =
	| { kind: 'state'; value: unknown }
	| { kind: 'ref'; value: { current: unknown } }
	| {
			kind: 'effect';
			dependencies: readonly unknown[] | undefined;
			cleanup?: EffectCleanup;
	  };

class HookHarness {
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
		const cache = this.useRef<{ dependencies: readonly unknown[] | undefined; value: T } | null>(null), previous = cache.current;
		if (dependencies && previous?.dependencies && dependencies.length === previous.dependencies.length &&
			dependencies.every((value, index) => Object.is(value, previous.dependencies?.[index]))) return previous.value;
		const value = compute(); cache.current = { dependencies, value }; return value;
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

type ElementLike = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const hooks = new HookHarness();
let route = new URL('https://explorer.invalid/explorer/issuers?q=A&return_to=%2Fexplorer');
const row = { id: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', homeDomain: 'issuer.example', assetCount: 2 };
const response = { data: [row], nextCursor: 'next_page', generatedAt: '2026-11-02T01:00:00Z', domainsReady: true };
const request = jest.fn(async (_path: string, _signal: AbortSignal): Promise<unknown> => response);
const push = jest.fn((_state: unknown, _title: string, href: string) => { route = new URL(href, route); });
jest.unstable_mockModule('react', () => ({ useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect, useMemo: hooks.useMemo }));
jest.unstable_mockModule('next/navigation', () => ({ usePathname: () => route.pathname, useSearchParams: () => route.searchParams }));
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({
	recordValue: (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {},
	requestExplorerJson: request
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-entity-navigation', () => ({ ExplorerEntityNavigation: () => null }));
jest.unstable_mockModule('../explorer-investigation', () => ({ ExplorerLink: (props: { children?: unknown }) => props.children }));
jest.unstable_mockModule('../../local-date-time', () => ({ LocalDateTime: (props: { dateTime: string }) => props.dateTime }));
const { ExplorerIssuerDirectory } = await import('../explorer-issuer-directory');
beforeEach(() => {
	hooks.reset(); request.mockReset(); request.mockResolvedValue(response); push.mockClear();
	route = new URL('https://explorer.invalid/explorer/issuers?q=A&return_to=%2Fexplorer');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { get location() { return route; }, history: { pushState: push } } });
});
afterEach(() => { hooks.reset(); Reflect.deleteProperty(globalThis, 'window'); });
function elements(node: unknown, predicate: (element: ElementLike) => boolean): ElementLike[] {
	if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
	if (!node || typeof node !== 'object' || !('props' in node) || !('type' in node)) return [];
	const element = node as ElementLike;
	return [...(predicate(element) ? [element] : []), ...elements(element.props.children, predicate)];
}
function text(node: unknown): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(text).join(' ');
	if (!node || typeof node !== 'object' || !('props' in node) || !('type' in node)) return '';
	const element = node as ElementLike;
	return typeof element.type === 'function' ? text(element.type(element.props)) : text(element.props.children);
}
const render = () => hooks.render(() => ExplorerIssuerDirectory());
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function rows(tree: unknown): number { return elements(elements(tree, element => element.type === 'tbody')[0]?.props.children, element => element.type === 'tr').length; }
function submit(tree: unknown): void { (elements(tree, element => element.type === 'form')[0]!.props.onSubmit as (event: unknown) => void)({ preventDefault: () => undefined }); }
function nextDisabled(tree: unknown): unknown { return elements(tree, element => element.type === 'button' && text(element.props.children) === 'Next page')[0]?.props.disabled; }

it.each(['?q=A&return_to=%2Fexplorer', '?q=%20A%20&return_to=%2Fexplorer'])('retains accepted rows and cursor without a request when only URL spelling/order normalizes: %s', async search => {
	route = new URL('/explorer/issuers' + search, route);
	render(); await settle(); let tree = render();
	expect(rows(tree)).toBe(1); expect(text(tree)).toContain(row.id); expect(nextDisabled(tree)).toBe(false);
	submit(tree); tree = render();
	expect(rows(tree)).toBe(1); expect(text(tree)).not.toContain('Issuer request cancelled.');
	expect(nextDisabled(tree)).toBe(false); expect(request).toHaveBeenCalledTimes(1);
	expect(push).toHaveBeenCalledTimes(1); expect(push.mock.calls[0]?.[0]).toBeNull();
	expect(route.searchParams.get('q')).toBe('A'); expect(route.searchParams.get('return_to')).toBe('/explorer');
	submit(tree); render(); await settle(); tree = render();
	expect(rows(tree)).toBe(1); expect(request).toHaveBeenCalledTimes(1); expect(push).toHaveBeenCalledTimes(1);
});

it('keeps typing local but clears/cancels accepted rows for a genuinely changed submitted search', async () => {
	const pending = Promise.withResolvers<unknown>();
	request.mockResolvedValueOnce(response).mockImplementationOnce(async () => pending.promise);
	render(); await settle(); let tree = render();
	const firstSignal = request.mock.calls[0]![1];
	(elements(tree, element => element.type === 'input' && element.props['aria-label'] === 'Search issuers')[0]!.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'B' } });
	tree = render(); expect(rows(tree)).toBe(1); expect(request).toHaveBeenCalledTimes(1);
	submit(tree); tree = render();
	expect(rows(tree)).toBe(0); expect(request).toHaveBeenCalledTimes(2); expect(firstSignal.aborted).toBe(true);
	expect(request.mock.calls[1]?.[0]).toContain('q=B'); expect(nextDisabled(tree)).toBe(true);
	pending.reject(new Error('New search unavailable')); await settle(); tree = render();
	expect(rows(tree)).toBe(0); expect(text(tree)).toContain('New search unavailable'); expect(text(tree)).not.toContain(row.id);
});

it('still retries an unsuccessful identical selection after URL normalization', async () => {
	request.mockRejectedValueOnce(new Error('Temporary issuer failure')).mockResolvedValueOnce(response);
	render(); await settle(); let tree = render();
	expect(rows(tree)).toBe(0); expect(text(tree)).toContain('Temporary issuer failure');
	submit(tree); render(); await settle(); tree = render();
	expect(request).toHaveBeenCalledTimes(2); expect(rows(tree)).toBe(1); expect(text(tree)).not.toContain('Issuer request cancelled.');
});
