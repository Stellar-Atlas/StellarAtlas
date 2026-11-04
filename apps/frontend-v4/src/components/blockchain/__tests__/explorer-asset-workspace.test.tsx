import { jest } from '@jest/globals';
import { HookHarness } from './asset-workspace-hook-harness';

type ElementLike = {
	type: string | ((props: Record<string, unknown>) => unknown) | symbol;
	props: Record<string, unknown> & { children?: unknown };
};
const hooks = new HookHarness();
let route = new URL('https://explorer.invalid/explorer/assets');
jest.unstable_mockModule('next/navigation', () => ({ usePathname: () => route.pathname, useSearchParams: () => route.searchParams }));
const requestMock = jest.fn(
	async (_path: string, _signal: AbortSignal): Promise<unknown> => ({
		data: [],
		nextCursor: null, generatedAt: '2026-11-02T01:00:00Z', coverage: { catalogueReady: true }
	})
);
const reactMock = {
	useEffect: hooks.useEffect,
	useMemo: hooks.useMemo,
	useRef: hooks.useRef,
	useState: hooks.useState
};
jest.unstable_mockModule('react', () => reactMock);
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({
	entityText: (row: Record<string, unknown>, key: string) =>
		typeof row[key] === 'string' || typeof row[key] === 'number'
			? String(row[key])
			: '',
	recordValue: (value: unknown) =>
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {},
	requestExplorerJson: requestMock
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-entity-navigation', () => ({
	ExplorerEntityNavigation: () => null
}));
jest.unstable_mockModule('../explorer-asset-tabs', () => ({
	ExplorerAssetTabs: () => null
}));
jest.unstable_mockModule('../explorer-investigation', () => ({
	ExplorerLink: (props: { children?: unknown }) => props.children,
	ExplorerInvestigationScope: (props: { children?: unknown }) => props.children
}));
jest.unstable_mockModule('../explorer-asset-holders', () => ({
	ExplorerAssetHolders: () => null
}));
jest.unstable_mockModule('../explorer-asset-markets', () => ({
	ExplorerAssetMarkets: () => null
}));
jest.unstable_mockModule('../../local-date-time', () => ({
	LocalDateTime: (props: { dateTime: string }) => props.dateTime
}));
jest.unstable_mockModule('next/link', () => ({
	default: (props: { children?: unknown }) => props.children
}));

let ExplorerAssetWorkspace: typeof import('../explorer-asset-workspace').ExplorerAssetWorkspace;
let AssetDetails: typeof import('../explorer-asset-views').AssetDetails;
let AssetTable: typeof import('../explorer-asset-views').AssetTable;
let Logo: typeof import('../explorer-asset-views').Logo;
let IssuerDetails: typeof import('../explorer-asset-views').IssuerDetails;
let ParsedIssuerMetadata: typeof import('../explorer-issuer-metadata').ParsedIssuerMetadata;

beforeAll(async () => {
	({ ExplorerAssetWorkspace } = await import('../explorer-asset-workspace'));
	({ AssetDetails, AssetTable, IssuerDetails, Logo } =
		await import('../explorer-asset-views'));
	({ ParsedIssuerMetadata } = await import('../explorer-issuer-metadata'));
});

beforeEach(() => {
	hooks.reset();
	requestMock.mockClear();
	requestMock.mockResolvedValue({ data: [], nextCursor: null, generatedAt: '2026-11-02T01:00:00Z', coverage: { catalogueReady: true } });
	route = new URL('https://explorer.invalid/explorer/assets');
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { get location() { return route; }, history: { pushState: jest.fn((_state: unknown, _title: string, href: string) => { route = new URL(href, route); }), replaceState: jest.fn() } }
	});
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
});

function renderWorkspace(props: Parameters<typeof ExplorerAssetWorkspace>[0]): unknown {
	const child = ExplorerAssetWorkspace(props) as unknown as ElementLike;
	if (typeof child.type !== 'function') throw new Error('Expected the selected discovery or record component.');
	return child.type(child.props);
}

function elements(
	node: unknown,
	predicate: (element: ElementLike) => boolean
): ElementLike[] {
	if (Array.isArray(node))
		return node.flatMap((child) => elements(child, predicate));
	if (
		!node ||
		typeof node !== 'object' ||
		!('props' in node) ||
		!('type' in node)
	)
		return [];
	const element = node as ElementLike;
	return [
		...(predicate(element) ? [element] : []),
		...elements(element.props.children, predicate)
	];
}

function renderedText(node: unknown): string {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(renderedText).join(' ');
	if (
		!node ||
		typeof node !== 'object' ||
		!('props' in node) ||
		!('type' in node)
	)
		return '';
	const element = node as ElementLike;
	if (typeof element.type === 'function')
		return renderedText(element.type(element.props));
	return renderedText(element.props.children);
}

describe('asset discovery workspace', () => {
	it('restarts exactly once when an explicit unchanged search normalizes only the URL', () => {
		route = new URL('https://explorer.invalid/explorer/assets?q=A&limit=100&return_to=%2Fexplorer');
		const render = () => hooks.render(() => renderWorkspace({}));
		const tree = render();
		expect(requestMock).toHaveBeenCalledTimes(1);
		const form = elements(tree, element => element.type === 'form')[0]!;
		(form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => undefined });
		render();
		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(requestMock.mock.calls.map(call => call[0])).toEqual(['/v1/assets?q=A&limit=25', '/v1/assets?q=A&limit=25']);
		expect(route.searchParams.has('limit')).toBe(false);
		expect(route.searchParams.get('return_to')).toBe('/explorer');
	});
	it('fetches the initial catalogue once and waits for explicit submit before applying typed filters', () => {
		const render = () =>
			hooks.render(() => renderWorkspace({}) as never);
		let tree = render();
		expect(requestMock).toHaveBeenCalledTimes(1);

		tree = render();
		expect(requestMock).toHaveBeenCalledTimes(1);

		const searchInput = elements(
			tree,
			(element) =>
				element.type === 'input' &&
				element.props['aria-label'] === 'Search assets'
		)[0]!;
		(searchInput.props.onChange as (event: unknown) => void)({
			currentTarget: { value: 'USDC' }
		});
		tree = render();

		const minLedger = elements(
			tree,
			(element) => element.type === 'input' && element.props.type === 'number'
		)[0]!;
		(minLedger.props.onChange as (event: unknown) => void)({
			currentTarget: { value: '60000000' }
		});
		tree = render();
		expect(requestMock).toHaveBeenCalledTimes(1);

		const form = elements(tree, (element) => element.type === 'form')[0]!;
		(form.props.onSubmit as (event: unknown) => void)({
			preventDefault: () => undefined
		});
		render();
		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(requestMock.mock.calls[1]?.[0]).toContain('q=USDC');
		expect(requestMock.mock.calls[1]?.[0]).toContain('min_ledger=60000000');
	});

	it('applies exact code and issuer, then restores a scoped cursor after clear, Back and reload', async () => {
		const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
		route = new URL('https://explorer.invalid/explorer/assets?return_to=%2Fexplorer#directory');
		requestMock.mockImplementation(async path => {
			const query = new URL(path, route).searchParams;
			return {
				data: [{ id: 'USD:' + issuer, code: 'USD', kind: 'classic', issuer }],
				nextCursor: query.get('issuer') && !query.has('cursor') ? 'catalogue-next' : null,
				generatedAt: '2026-11-02T01:00:00Z',
				coverage: { catalogueReady: true, observedAssetCount: 98765 }
			};
		});
		const render = () => hooks.render(() => renderWorkspace({}));
		const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
		const button = (tree: unknown, label: string) => elements(tree, e =>
			e.type === 'button' && (e.props.children === label || e.props['aria-label'] === label))[0]!;
		const click = (tree: unknown, label: string) => {
			const control = button(tree, label);
			expect(control.props.disabled).toBeFalsy();
			(control.props.onClick as () => void)();
		};
		const input = (tree: unknown, label: string) => {
			const field = elements(tree, e => e.type === 'label' && Array.isArray(e.props.children) && e.props.children[0] === label)[0]!;
			return elements(field, e => e.type === 'input')[0]!;
		};
		const lastRequest = () => new URL(requestMock.mock.calls.at(-1)![0], route).searchParams;
		render();
		let tree = await settle();
		for (const [label, value] of [['Exact asset code', 'USD'], ['Issuer address', issuer], ['From ledger', '100']] as const) {
			(input(tree, label).props.onChange as (event: unknown) => void)({ currentTarget: { value } });
			tree = render();
		}
		expect(requestMock).toHaveBeenCalledTimes(1);
		(elements(tree, e => e.type === 'form')[0]!.props.onSubmit as (event: unknown) => void)({ preventDefault: () => undefined });
		render(); tree = await settle();
		expect(Object.fromEntries(lastRequest())).toEqual({ symbol: 'USD', issuer, min_ledger: '100', limit: '25' });
		expect(renderedText(tree)).toContain('Published catalogue coverage may be incomplete.');
		expect(renderedText(tree)).toMatch(/1\s+asset\s+on this page/);
		expect(renderedText(tree)).not.toContain('98765');
		expect(renderedText(tree)).toMatch(/From ledger\s*:\s*100/);
		click(tree, 'Next assets'); render(); tree = await settle();
		expect(lastRequest().get('cursor')).toBe('catalogue-next');
		expect(lastRequest().has('cursor_for')).toBe(false);
		const saved = route.href;

		hooks.reset(); render(); tree = await settle();
		expect(lastRequest().get('cursor')).toBe('catalogue-next');
		expect(input(tree, 'Exact asset code').props.value).toBe('USD');
		expect(input(tree, 'Issuer address').props.value).toBe(issuer);
		click(tree, 'Remove from ledger filter'); render(); tree = await settle();
		expect(Object.fromEntries(lastRequest())).toEqual({ symbol: 'USD', issuer, limit: '25' });
		expect(route.searchParams.has('cursor_for')).toBe(false);
		click(tree, 'Clear all filters'); render(); tree = await settle();
		expect(Object.fromEntries(lastRequest())).toEqual({ limit: '25' });
		expect(route.searchParams.get('return_to')).toBe('/explorer');
		expect(route.hash).toBe('#directory');
		expect(renderedText(tree)).not.toContain('Clear all filters');

		route = new URL(saved); render(); tree = await settle(); // Browser Back to the prior continued result.
		expect(Object.fromEntries(lastRequest())).toEqual({ symbol: 'USD', issuer, min_ledger: '100', cursor: 'catalogue-next', limit: '25' });
		expect(renderedText(tree)).toMatch(/From ledger\s*:\s*100/);
	});

	it('reports an unavailable catalogue without presenting it as zero matches', async () => {
		requestMock.mockResolvedValueOnce({ data: [], nextCursor: null, generatedAt: null, coverage: { catalogueReady: false } });
		const render = () => hooks.render(() => renderWorkspace({}));
		render(); await new Promise(resolve => setImmediate(resolve));
		const text = renderedText(render());
		expect(text).toContain('Asset catalogue is not available yet.');
		expect(text).not.toMatch(/assets on this page|No assets matched/);
	});
});

describe('asset detail presentation', () => {
	it('builds Browse all assets from current client origin, not stale initial or child filters, without refetching', () => {
		route = new URL('https://explorer.invalid/explorer/assets/native?tab=contracts-events&q=event&activity=state&ledger_key_hash=key');
		const render = () => hooks.render(() => renderWorkspace({ assetRef: 'native', initialFilters: { q: 'stale', min_ledger: '999' } }));
		const browse = (tree: unknown) => elements(tree, element => element.props.children === 'Browse all assets')[0]!.props.href;
		expect(browse(render())).toBe('/explorer/assets');
		const directory = '/explorer/assets?q=USD&min_ledger=100&max_ledger=101';
		route = new URL(route.pathname + '?' + new URLSearchParams({ return_to: directory, q: 'another event' }), route);
		expect(browse(render())).toBe(directory);
		route = new URL(route.pathname + '?q=child&after=event', route);
		expect(browse(render())).toBe('/explorer/assets');
		expect(requestMock).toHaveBeenCalledTimes(1);
	});
	it('normalizes an encoded CODE:ISSUER ref before detail detection and API lookup', async () => {
		const code = 'BEER';
		const issuer = 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG';
		requestMock.mockResolvedValueOnce({
			asset: { id: `${code}:${issuer}`, kind: 'classic', code, issuer },
			metadata: {
				status: 'ready',
				logoUrl: 'https://stellar.example/beer.png',
				organization: { name: 'Beer Company' }
			},
			links: {}
		});
		const encodedRef = `${code}%3A${issuer}`;
		let tree = hooks.render(() =>
			renderWorkspace({ assetRef: encodedRef })
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() => renderWorkspace({ assetRef: encodedRef }));

		expect(requestMock).toHaveBeenCalledTimes(1);
		expect(requestMock.mock.calls[0]?.[0]).toBe(`/v1/assets/${encodedRef}`);
		expect(renderedText(tree)).toContain('BEER');
		expect(renderedText(tree)).not.toContain(`Matches for ${encodedRef}`);
	});

	it('treats cached issuer TOML with fetchedAt and empty fields as ready', async () => {
		requestMock.mockResolvedValueOnce({
			issuer: {
				id: 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG'
			},
			metadata: {
				homeDomain: 'stellar.example',
				fields: {},
				currencies: [],
				fetchedAt: '2026-10-12T12:00:00.000Z',
				error: null
			},
			assets: { data: [], nextCursor: null }
		});
		let tree = hooks.render(() =>
			renderWorkspace({
				issuerId: 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG'
			})
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() =>
			renderWorkspace({
				issuerId: 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG'
			})
		);
		const text = renderedText(tree);
		expect(text).toContain('Issuer-published metadata');
		expect(text).not.toContain('Metadata is pending or incomplete');
	});

	it('shows explicit issuer metadata errors without treating them as pending', async () => {
		requestMock.mockResolvedValueOnce({
			issuer: { id: 'GISSUER' },
			metadata: {
				homeDomain: null,
				fields: {},
				currencies: [],
				fetchedAt: null,
				error: 'TOML retrieval failed'
			},
			assets: { data: [], nextCursor: null }
		});
		let tree = hooks.render(() =>
			renderWorkspace({ issuerId: 'GISSUER' })
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() => renderWorkspace({ issuerId: 'GISSUER' }));
		const text = renderedText(tree);
		expect(text).toContain('TOML retrieval failed');
		expect(text).not.toContain('Metadata is pending or incomplete');
	});

	it('links exact first and last observed ledger numbers to ledger explorer routes', () => {
		const tree = AssetTable({
			assets: [
				{
					id: 'USD:GISSUER',
					kind: 'classic',
					code: 'USD',
					issuer: 'GISSUER',
					firstObservedLedger: 64912451,
					lastObservedLedger: 64912514
				}
			]
		});
		const text = renderedText(tree);
		const links = elements(tree, (element) => 'href' in element.props).map(
			(element) => element.props.href
		);
		const ledgerLinks = elements(
			tree,
			(element) =>
				typeof element.props.href === 'string' &&
				String(element.props.href).startsWith('/explorer/ledgers/')
		);
		expect(text).toContain('First observed');
		expect(text).toContain('Last observed');
		expect(links).toContain('/explorer/ledgers/64912451');
		expect(links).toContain('/explorer/ledgers/64912514');
		expect(ledgerLinks.map((element) => element.props.children)).toEqual([
			'64,912,451', '64,912,514'
		]);
	});
	it('renders structured issuer organization, preserves cached logo paths, and links to explorer routes', () => {
		const asset = {
			id: 'USD:GISSUER',
			kind: 'classic' as const,
			code: 'USD',
			issuer: 'GISSUER',
			logoUrl: '/v1/asset-logos/cache-key'
		};
		const record = {
			asset,
			metadata: {
				status: 'ready',
				organization: { name: 'North Star', dba: 'North Star Pay' },
				fields: { ORG_URL: 'northstar.example' }
			}
		};
		const tree = hooks.render(() =>
			AssetDetails({ record, onRefresh: () => undefined, pending: false })
		);
		const logo = Logo({ asset, metadata: record.metadata });
		const text = renderedText(ParsedIssuerMetadata({ metadata: record.metadata }));
		const links = elements(tree, (element) => 'href' in element.props).map(
			(element) => element.props.href
		);
		const images = elements(logo, (element) => element.type === 'img').map(
			(element) => element.props.src
		);
		expect(text).toContain('North Star');
		expect(text).toContain('northstar.example');
		expect(links).toContain('/explorer/issuers/GISSUER');
		expect(links).toContain('/explorer/transfers?asset=USD%3AGISSUER');
		expect(images).toContain('/v1/asset-logos/cache-key');
	});

	it('links Soroban contracts to contract explorer details, never API hrefs', () => {
		const tree = hooks.render(() =>
			AssetDetails({
				record: {
					asset: { id: 'C123', kind: 'contract', contractId: 'C123' },
					metadata: { status: 'unavailable' }
				},
				onRefresh: () => undefined,
				pending: false
			})
		);
		const links = elements(tree, (element) => 'href' in element.props).map(
			(element) => element.props.href
		);
		expect(links).toContain('/explorer/contracts/C123');
		expect(links).toContain('/explorer/transfers?asset=C123');
		expect(
			links.some((href) => typeof href === 'string' && href.startsWith('/v1/'))
		).toBe(false);
	});
	it('keeps issuer claims out of asset headings and explicitly attributes parsed TOML', () => {
		const metadata = {
			name: 'Commodity shares', description: 'A can of beer',
			fields: { redemption_instructions: '<script>do not execute</script>' },
			tomlUrl: 'https://issuer.example/.well-known/stellar.toml'
		};
		const tree = hooks.render(() =>
			AssetDetails({
				record: {
					asset: {
						id: 'BEER:GISSUER',
						kind: 'classic',
						code: 'BEER',
						issuer: 'GISSUER',
						name: 'Commodity shares'
					},
					metadata
				},
				onRefresh: () => undefined,
				pending: false
			})
		);
		const headings = elements(tree, (element) => element.type === 'h3').map(
			(element) => renderedText(element.props.children)
		);
		expect(headings).toEqual(['BEER']);
		expect(renderedText(tree)).toContain('Classic asset');
		expect(renderedText(tree)).not.toContain('Commodity shares');
		expect(renderedText(ParsedIssuerMetadata({ metadata }))).toContain(
			'Not verified or endorsed by StellarAtlas.'
		);
		expect(renderedText(ParsedIssuerMetadata({ metadata }))).toContain('<script>do not execute</script>');
		expect(
			elements(ParsedIssuerMetadata({ metadata }), (element) => 'dangerouslySetInnerHTML' in element.props)
		).toHaveLength(0);
	});
	it('uses asset codes rather than issuer-supplied names in discovery', () => {
		const tree = AssetTable({
			assets: [
				{
					id: 'BEER:GISSUER',
					kind: 'classic',
					code: 'BEER',
					name: 'Commodity shares'
				}
			]
		});
		expect(renderedText(tree)).toContain('BEER');
		expect(renderedText(tree)).not.toContain('Commodity shares');
	});

	it('reads issuer TOML organization fields when organization is not pre-normalized', () => {
		const tree = hooks.render(() =>
			IssuerDetails({
				issuerId: 'GISSUER',
				record: {
					asset: { id: 'GISSUER', kind: 'classic', issuer: 'GISSUER' },
					metadata: {
						fields: { ORG_NAME: 'Issuer From TOML', ORG_DBA: 'Issuer DBA' }
					}
				},
				assets: { data: [], nextCursor: null },
				onRefresh: () => undefined,
				pending: false
			})
		);
		expect(renderedText(tree)).toContain('Issuer From TOML');
	});
});
