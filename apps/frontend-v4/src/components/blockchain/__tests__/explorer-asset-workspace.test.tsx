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

type ElementLike = {
	type: string | ((props: Record<string, unknown>) => unknown) | symbol;
	props: Record<string, unknown> & { children?: unknown };
};
const hooks = new HookHarness();
const requestMock = jest.fn(
	async (_path: string, _signal: AbortSignal): Promise<unknown> => ({
		data: [],
		nextCursor: null
	})
);
const reactMock = {
	useEffect: hooks.useEffect,
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

beforeAll(async () => {
	({ ExplorerAssetWorkspace } = await import('../explorer-asset-workspace'));
	({ AssetDetails, AssetTable, IssuerDetails, Logo } =
		await import('../explorer-asset-views'));
});

beforeEach(() => {
	hooks.reset();
	requestMock.mockClear();
	requestMock.mockResolvedValue({ data: [], nextCursor: null });
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { history: { replaceState: jest.fn() } }
	});
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
});

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
	it('fetches the initial catalogue once and waits for explicit submit before applying typed filters', () => {
		const render = () =>
			hooks.render(() => ExplorerAssetWorkspace({}) as never);
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
});

describe('asset detail presentation', () => {
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
			ExplorerAssetWorkspace({ assetRef: encodedRef })
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() => ExplorerAssetWorkspace({ assetRef: encodedRef }));

		expect(requestMock).toHaveBeenCalledTimes(1);
		expect(requestMock.mock.calls[0]?.[0]).toBe(`/v1/assets/${encodedRef}`);
		expect(renderedText(tree)).toContain('Beer Company');
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
			ExplorerAssetWorkspace({
				issuerId: 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG'
			})
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() =>
			ExplorerAssetWorkspace({
				issuerId: 'GDW3CNKSP5AOTDQ2YCKNGC6L65CE4JDX3JS5BV427OB54HCF2J4PUEVG'
			})
		);
		const text = renderedText(tree);
		expect(text).toContain('Issuer metadata');
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
			ExplorerAssetWorkspace({ issuerId: 'GISSUER' })
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		tree = hooks.render(() => ExplorerAssetWorkspace({ issuerId: 'GISSUER' }));
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
			64912451, 64912514
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
		const text = renderedText(tree);
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
					metadata: {
						name: 'Commodity shares',
						description: 'A can of beer',
						fields: {
							redemption_instructions: '<script>do not execute</script>'
						},
						tomlUrl: 'https://issuer.example/.well-known/stellar.toml'
					}
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
		expect(renderedText(tree)).toContain(
			'Not verified or endorsed by StellarAtlas.'
		);
		expect(renderedText(tree)).toContain('<script>do not execute</script>');
		expect(
			elements(tree, (element) => 'dangerouslySetInnerHTML' in element.props)
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
