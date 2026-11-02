import * as ReactActual from 'react';
import * as RuntimeActual from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import { recordValue } from '../../../api/explorer-analytics';

// Capture real component callbacks and replay its effects/state deterministically.
// This is not a browser/DOM scheduler or a real cryptographic verification.
const values: unknown[] = [];
let cursor = 0;
let previous: ReactActual.DependencyList | undefined;
let cleanup: (() => void) | undefined;
let scheduled: ReactActual.EffectCallback | undefined;
const buttons = new Map<string, () => void>();
const request =
	jest.fn<(path: string, signal: AbortSignal) => Promise<unknown>>();
jest.unstable_mockModule('react', () => ({
	...ReactActual,
	useState: (initial: unknown) => {
		const index = cursor++;
		if (!(index in values)) values[index] = initial;
		return [
			values[index],
			(next: unknown) => {
				values[index] =
					typeof next === 'function'
						? (next as (old: unknown) => unknown)(values[index])
						: next;
			}
		];
	},
	useEffect: (
		effect: ReactActual.EffectCallback,
		deps: ReactActual.DependencyList
	) => {
		if (
			!previous ||
			deps.some((value, index) => !Object.is(value, previous![index]))
		) {
			scheduled = effect;
			previous = deps;
		}
	}
}));
function capture(
	kind: 'jsx' | 'jsxs',
	type: ReactActual.ElementType,
	props: Record<string, unknown>,
	key?: string
) {
	if (
		type === 'button' &&
		typeof props.children === 'string' &&
		typeof props.onClick === 'function'
	)
		buttons.set(props.children, props.onClick as () => void);
	return RuntimeActual[kind](type, props, key);
}
jest.unstable_mockModule('react/jsx-runtime', () => ({
	...RuntimeActual,
	jsx: (
		type: ReactActual.ElementType,
		props: Record<string, unknown>,
		key?: string
	) => capture('jsx', type, props, key),
	jsxs: (
		type: ReactActual.ElementType,
		props: Record<string, unknown>,
		key?: string
	) => capture('jsxs', type, props, key)
}));
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({
	recordValue,
	requestExplorerJson: request
}));
jest.unstable_mockModule('../explorer-investigation', () => ({
	ExplorerLink: (props: ReactActual.AnchorHTMLAttributes<HTMLAnchorElement>) =>
		ReactActual.createElement('a', props)
}));
jest.unstable_mockModule('../../local-date-time', () => ({
	LocalDateTime: ({ dateTime }: { dateTime: string }) =>
		ReactActual.createElement('time', null, dateTime)
}));
const { ExplorerContractProvenance } =
	await import('../explorer-contract-provenance');
const hash = 'a'.repeat(64),
	commit = 'b'.repeat(40);
function evidence(status = 'verified', contractId = 'contract-A') {
	return {
		contractId,
		observedLedger: 150,
		checkedAt: '2026-01-01T00:00:00Z',
		wasmSha256: hash,
		metadata: { sourceRepository: 'example/contract' },
		build: {
			status,
			record:
				status === 'verified'
					? {
							commit,
							sourceUrl: 'https://github.com/example/contract/tree/' + commit,
							workflowUrl:
								'https://github.com/example/contract/blob/' +
								commit +
								'/.github/workflows/release.yml'
						}
					: null
		},
		securityAudit: 'not_assessed'
	};
}
function render(contractId = 'contract-A') {
	cursor = 0;
	buttons.clear();
	return renderToStaticMarkup(
		ReactActual.createElement(ExplorerContractProvenance, { contractId })
	);
}
function effects() {
	if (scheduled) {
		cleanup?.();
		const effect = scheduled;
		scheduled = undefined;
		cleanup = effect() || undefined;
	}
}
async function settled() {
	await Promise.resolve();
	await Promise.resolve();
}
function click(label: string) {
	const callback = buttons.get(label);
	if (!callback) throw new Error('Missing actual button ' + label);
	callback();
}
beforeEach(() => {
	cleanup?.();
	cleanup = undefined;
	scheduled = undefined;
	previous = undefined;
	values.length = 0;
	request.mockReset();
});
afterEach(() => cleanup?.());
describe('synthetic contract provenance interaction journey', () => {
	it.each([
		['verified', 'Build attested'],
		['invalid', 'Build verification failed'],
		['not_published', 'No published build'],
		['unavailable', 'Build check unavailable']
	])('renders %s only after explicit Check build', async (status, label) => {
		request.mockResolvedValue(evidence(status));
		expect(render()).toContain('Check build');
		effects();
		expect(request).not.toHaveBeenCalled();
		click('Check build');
		render();
		effects();
		await settled();
		const html = render();
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]![0]).toBe(
			'/v1/contracts/contract-A/provenance'
		);
		expect(html).toContain(label);
		expect(html).toContain(hash);
		if (status === 'verified') {
			expect(html).toContain(commit);
			expect(html).toContain('not a security audit');
		} else {
			expect(html).not.toContain('Build attested');
			expect(html).not.toContain(commit);
		}
		render();
		effects();
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('offers one manual Retry after transport error instead of automatic retries', async () => {
		request
			.mockRejectedValueOnce(new Error('Synthetic HTTP503'))
			.mockResolvedValueOnce(evidence());
		render();
		click('Check build');
		render();
		effects();
		await settled();
		await settled();
		expect(render()).toContain('Retry');
		expect(request).toHaveBeenCalledTimes(1);
		click('Retry');
		render();
		effects();
		await settled();
		expect(render()).toContain('Build attested');
		expect(request).toHaveBeenCalledTimes(2);
	});
	it('aborts A on contract change and rejects its late success', async () => {
		let resolveA: (value: unknown) => void = () => {};
		request
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveA = resolve;
					})
			)
			.mockResolvedValueOnce(evidence('not_published', 'contract-B'));
		render();
		click('Check build');
		render();
		effects();
		const signal = request.mock.calls[0]![1];
		render('contract-B');
		effects();
		expect(signal.aborted).toBe(true);
		resolveA(evidence());
		await settled();
		const html = render('contract-B');
		expect(html).not.toContain('Build attested');
		expect(html).toContain('No published build');
	});
	it('never renders accepted A evidence under contract B before replacement effect runs', async () => {
		request.mockResolvedValue(evidence());
		render();
		click('Check build');
		render();
		effects();
		await settled();
		expect(render()).toContain('Build attested');
		const html = render('contract-B');
		expect(html).not.toContain(hash);
		expect(html).not.toContain(commit);
		expect(html).not.toContain('Build attested');
	});
	it('never renders A errors on B and rejects a late A result before cleanup', async () => {
		request.mockRejectedValueOnce(new Error('Synthetic A failure'));
		render();
		click('Check build');
		render();
		effects();
		await settled();
		await settled();
		expect(render()).toContain('Retry');
		expect(render('contract-B')).not.toContain('Temporarily unavailable');
		expect(render('contract-B')).not.toContain('Retry');
		cleanup?.();
		cleanup = undefined;
		scheduled = undefined;
		previous = undefined;
		values.length = 0;
		request.mockReset();
		let resolveA: (value: unknown) => void = () => {};
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveA = resolve;
				})
		);
		render();
		click('Check build');
		render();
		effects();
		render('contract-B');
		resolveA(evidence());
		await settled();
		const html = render('contract-B');
		expect(html).not.toContain(hash);
		expect(html).not.toContain('Build attested');
	});
});
