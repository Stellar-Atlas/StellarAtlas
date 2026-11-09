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
let verifyBuild: ReactActual.FormEventHandler<HTMLFormElement> | undefined;
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
	if (type === 'form' && typeof props.onSubmit === 'function')
		verifyBuild = props.onSubmit as ReactActual.FormEventHandler<HTMLFormElement>;
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
jest.unstable_mockModule('../explorer-contract-provenance.module.css', () => ({ default: {} }));
const { ExplorerContractProvenance, parseLedgerEvidence } =
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
function submitBuild(sourceCommit = commit, wasmSha256 = hash) {
	if (!verifyBuild) throw new Error('Missing builder form');
	const preventDefault = jest.fn();
	const fields: Record<string, { value: string }> = {
		'input[data-build-field="commit"]': { value: sourceCommit },
		'input[data-build-field="wasmSha256"]': { value: wasmSha256 }
	};
	const currentTarget = { querySelector: (selector: string) => fields[selector] ?? null };
	verifyBuild({ preventDefault, currentTarget } as unknown as ReactActual.FormEvent<HTMLFormElement>);
	expect(preventDefault).toHaveBeenCalledTimes(1);
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
	it('parses the exact marker and conservatively distinguishes absent and unexpected values', () => {
		expect(parseLedgerEvidence('configured_rpc_observation')).toBe('configured_rpc_observation');
		expect(parseLedgerEvidence(undefined)).toBe('unspecified');
		for (const marker of [null, {}, 'CONFIGURED_RPC_OBSERVATION', 'independent_proof']) {
			expect(parseLedgerEvidence(marker)).toBe('unknown');
		}
	});

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
		expect(html).not.toContain('Ledger evidence');
		if (status === 'verified') {
			expect(html).toContain(commit);
			expect(html).toContain('reproduction and security audit are separate checks');
		} else {
			expect(html).not.toContain('Build attested');
			expect(html).not.toContain(commit);
		}
		render();
		effects();
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('guides an unpublished builder and checks again after publication', async () => {
		request
			.mockResolvedValueOnce(evidence('not_published'))
			.mockResolvedValueOnce(evidence());
		const initial = render();
		expect(initial).toContain('Verify my build');
		expect(initial).toContain('source_repo=github:OWNER/REPO');
		expect(initial).toContain('/docs/contract-verification#publish-build');
		submitBuild(commit.toUpperCase(), ' ' + hash + ' ');
		expect(render()).toContain('Checking');
		effects();
		await settled();
		const unpublished = render();
		expect(unpublished).toContain('No published build');
		expect(unpublished).toContain('Publish a GitHub artifact attestation');
		expect(unpublished).not.toContain('Your build is attested');
		click('Check again');
		expect(render()).not.toContain('No published build');
		effects();
		await settled();
		const matched = render();
		expect(matched).toContain('Your build is attested');
		expect(matched).toContain(commit);
		expect(matched).toContain(hash);
		expect(request.mock.calls.map(([path]) => path)).toEqual([
			'/v1/contracts/contract-A/provenance',
			'/v1/contracts/contract-A/provenance'
		]);
		expect(render('contract-B')).not.toContain('Requested commit');
	});
	it.each([
		[commit, 'c'.repeat(64), 'Wasm hash mismatch'],
		['c'.repeat(40), hash, 'Source commit mismatch']
	])('keeps an attested release distinct from a mismatching request', async (sourceCommit, wasmSha256, label) => {
		request.mockResolvedValue(evidence());
		render();
		submitBuild(sourceCommit, wasmSha256);
		render();
		effects();
		await settled();
		const html = render();
		expect(html).toContain(label);
		expect(html).not.toContain('Your build is attested');
	});
	it('rejects malformed release inputs before asking Atlas to check', () => {
		render();
		submitBuild('main', hash);
		expect(render()).toContain('Enter the full 40-character commit');
		effects();
		expect(request).not.toHaveBeenCalled();
	});
	it.each(['Check build', 'Verify build'])('rejects wrong or missing contract identity for %s', async (action) => {
		const { contractId, ...missingContractId } = evidence();
		expect(contractId).toBe('contract-A');
		for (const response of [evidence('verified', 'contract-B'), missingContractId]) {
			request.mockResolvedValueOnce(response);
		}
		render();
		if (action === 'Check build') click('Check build');
		else submitBuild();
		render();
		effects();
		await settled();
		for (const retry of [true, false]) {
			const html = render();
			expect(html).toContain('Temporarily unavailable');
			expect(html).not.toContain('Build attested');
			expect(html).not.toContain('Your build is attested');
			expect(html).not.toContain('/tree/' + commit);
			expect(html).not.toContain('Observed ledger');
			if (retry) {
				click('Retry');
				render();
				effects();
				await settled();
			}
		}
		expect(request).toHaveBeenCalledTimes(2);
	});
	it('hides the prior match after malformed replacement and checks only after correction', async () => {
		request.mockResolvedValue(evidence());
		render();
		submitBuild();
		render();
		effects();
		await settled();
		expect(render()).toContain('Your build is attested');
		submitBuild('main', hash);
		const rejected = render();
		effects();
		expect(rejected).toContain('Enter the full 40-character commit');
		expect(rejected).not.toContain('Your build is attested');
		expect(rejected).not.toContain('Build attested');
		expect(rejected).not.toContain('Check again');
		expect(rejected).not.toContain('/tree/' + commit);
		expect(request).toHaveBeenCalledTimes(1);
		submitBuild();
		render();
		effects();
		await settled();
		expect(render()).toContain('Your build is attested');
		expect(request).toHaveBeenCalledTimes(2);
	});
	it.each([
		['verified', 'Build attested'],
		['invalid', 'Build verification failed'],
		['unavailable', 'Build check unavailable']
	])('attributes the observation without changing the %s build verdict', async (status, label) => {
		request.mockResolvedValue({
			...evidence(status),
			ledgerEvidence: 'configured_rpc_observation',
			rpcUrl: 'https://private.invalid/rpc'
		});
		render();
		click('Check build');
		render();
		effects();
		await settled();
		const html = render();
		expect(html).toContain('Configured RPC observation. Not an independent ledger-state proof.');
		expect(html).toContain(label);
		expect(html).not.toContain('private.invalid');
		expect(html.includes(commit)).toBe(status === 'verified');
	});
	it('does not echo an unrecognized ledger evidence value or use it as proof', async () => {
		const marker = 'https://private.invalid/claimed-ledger-proof';
		request.mockResolvedValue({ ...evidence(), ledgerEvidence: marker });
		render();
		click('Check build');
		render();
		effects();
		await settled();
		const html = render();
		expect(html).toContain('Unrecognized ledger evidence. Do not treat it as a ledger-state proof.');
		expect(html).not.toContain(marker);
		expect(html).toContain('Build attested');
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
