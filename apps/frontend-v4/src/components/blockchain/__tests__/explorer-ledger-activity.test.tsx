import { jest } from '@jest/globals';
import { HookHarness } from './asset-workspace-hook-harness';

type ElementLike = {
	key: string | null;
	type: string | ((props: Record<string, unknown>) => unknown) | symbol;
	props: Record<string, unknown>;
};
const hooks = new HookHarness();
const base = 'https://explorer.invalid';
const origin = '/explorer?search_type=ledger&search=100';
const initial = '/explorer/ledgers/100?' + new URLSearchParams({ return_to: origin, ledger_view: 'transactions' }) + '#activity';
let route = new URL(initial, base);
let currentKey: string | null = null;
const request = jest.fn(async (path: string) => {
	const offset = Number(new URL(path, base).searchParams.get('offset'));
	if (offset === 25) throw new Error('Synthetic next-page failure');
	return { dataset: 'history_transactions', limit: 25, offset, nextOffset: 25, rows: [{
		transaction_hash: 'a'.repeat(64), ledger_sequence: 100,
		account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		fee_charged: '9007199254740993', operation_count: 1, successful: true,
		closed_at: '2026-11-02T00:00:00Z'
	}] };
});
jest.unstable_mockModule('react', () => ({
	useEffect: hooks.useEffect, useRef: hooks.useRef, useState: hooks.useState,
	useCallback: <T,>(fn: T, dependencies: readonly unknown[]) => hooks.useMemo(() => fn, dependencies)
}));
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => route.pathname, useSearchParams: () => route.searchParams, useRouter: () => ({ push: jest.fn() })
}));
jest.unstable_mockModule('../explorer-investigation', () => ({ ExplorerLink: () => null, useExplorerReturnTo: () => origin }));
jest.unstable_mockModule('../explorer-transaction-table', () => ({ ExplorerTransactionTable: () => null }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const analytics = await import('../../../api/explorer-analytics');
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({ ...analytics, requestExplorerJson: request }));
const { ExplorerLedgerActivity } = await import('../explorer-ledger-activity');

function find(node: unknown, test: (element: ElementLike) => boolean): ElementLike | undefined {
	if (Array.isArray(node)) return node.map(child => find(child, test)).find(Boolean);
	if (!node || typeof node !== 'object' || !('props' in node) || !('type' in node)) return undefined;
	const element = node as ElementLike;
	return test(element) ? element : find(element.props.children, test);
}
function component(element: ElementLike | undefined): unknown {
	if (typeof element?.type !== 'function') throw new Error('Expected component');
	return element.type(element.props);
}
function renderPage(): unknown {
	const root = component(ExplorerLedgerActivity({ ledger: '100' }) as unknown as ElementLike);
	const page = find(root, item => 'offset' in item.props && 'onPage' in item.props);
	if (!page) throw new Error('Expected ledger transactions panel');
	if (page.key !== currentKey) { hooks.reset(); currentKey = page.key; }
	return hooks.render(() => component(page));
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const control = (tree: unknown, name: string) => find(tree, e => e.type === 'button' && e.props.children === name);
const activate = (item: ElementLike | undefined) => {
	if (!item || item.props.disabled || typeof item.props.onClick !== 'function') throw new Error('Expected enabled control');
	item.props.onClick();
};

beforeEach(() => {
	route = new URL(initial, base); currentKey = null; request.mockClear();
	Object.defineProperty(globalThis, 'window', { configurable: true, value: {
		get location() { return route; },
		history: { pushState: (_state: unknown, _title: string, href: string) => { route = new URL(href, base); } }
	} });
});
afterEach(() => { hooks.reset(); Reflect.deleteProperty(globalThis, 'window'); });

it('recovers the previous ledger page after a failed continuation without showing stale rows', async () => {
	renderPage(); await settle();
	activate(control(renderPage(), 'Next transactions'));
	renderPage();
	expect(control(renderPage(), 'Previous transactions')?.props.disabled).toBe(true);
	await settle();
	const failed = renderPage();
	expect(find(failed, item => 'transactions' in item.props)).toBeUndefined();
	expect(find(failed, item => typeof item.props.error === 'string')?.props.error).toContain('could not be loaded');
	expect(control(failed, 'Next transactions')?.props.disabled).toBe(true);
	activate(control(failed, 'Previous transactions'));
	expect(route.pathname + route.search + route.hash).toBe(initial);
	renderPage(); await settle();
	expect(find(renderPage(), item => 'transactions' in item.props)).toBeDefined();
	expect(request.mock.calls.map(([path]) => {
		const params = new URL(path, base).searchParams;
		return [params.get('ledger_sequence'), params.get('limit'), params.get('offset')];
	})).toEqual([['100','25','0'],['100','25','25'],['100','25','0']]);
});
