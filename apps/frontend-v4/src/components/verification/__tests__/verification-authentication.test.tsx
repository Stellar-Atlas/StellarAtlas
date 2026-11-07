import { jest } from '@jest/globals';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HookHarness } from '../../blockchain/__tests__/asset-workspace-hook-harness';
const harness = new HookHarness();
jest.unstable_mockModule('react', () => ({
	...React,
	useState: harness.useState,
	useRef: harness.useRef,
	useEffect: harness.useEffect
}));
const { VerificationAuthentication } =
	await import('../verification-authentication');
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const fetchMock = jest.fn<typeof fetch>();
const onSession = jest.fn();
const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const expiry = () => new Date(Date.now() + 60_000).toISOString();
const response = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!React.isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children as React.ReactNode)];
}
const render = () =>
	harness.render(() =>
		VerificationAuthentication({ networks: ['mainnet'], onSession })
	);
const settle = () => new Promise((resolve) => setImmediate(resolve));
function submit(index: number) {
	const form = elements(render()).filter((node) => node.type === 'form')[
		index
	]!;
	(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
		preventDefault: () => undefined
	});
}
beforeEach(() => {
	harness.reset();
	fetchMock.mockReset();
	onSession.mockReset();
	globalThis.fetch = fetchMock;
	Object.defineProperty(globalThis, 'window', {
		value: { location: { hostname: 'atlas.example.org' } },
		configurable: true
	});
});
afterEach(() => {
	harness.reset();
	globalThis.fetch = originalFetch;
	if (originalWindow)
		Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
});
async function challenge(homeDomain = 'atlas.example.org') {
	fetchMock.mockResolvedValueOnce(
		response({
			transaction: 'AAAA',
			expiresAt: expiry(),
			network: 'mainnet',
			homeDomain,
			serverAccount: address
		})
	);
	const field = elements(render()).find((node) => node.props.maxLength === 56)!;
	(field.props.onChange as (event: { target: { value: string } }) => void)({
		target: { value: address }
	});
	submit(0);
	await settle();
}
it('requests no challenge before a user submits and requires the expected home domain', async () => {
	render();
	expect(fetchMock).not.toHaveBeenCalled();
	await challenge('foreign.example.org');
	expect(renderToStaticMarkup(render())).toContain(
		'challenge could not be read'
	);
	expect(onSession).not.toHaveBeenCalled();
});
it('exchanges a wallet-signed challenge, keeps the bearer token out of the page and revokes on sign out', async () => {
	await challenge();
	const html = renderToStaticMarkup(render());
	expect(html).toContain('sequence number 0');
	expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
	const field = elements(render()).find(
		(node) => node.props.maxLength === 16384
	)!;
	(field.props.onChange as (event: { target: { value: string } }) => void)({
		target: { value: 'signed-xdr' }
	});
	const session = {
		token: 't'.repeat(43),
		network: 'mainnet',
		address,
		expiresAt: expiry()
	};
	fetchMock.mockResolvedValueOnce(response(session));
	submit(1);
	await settle();
	expect(onSession).toHaveBeenLastCalledWith(session);
	expect(renderToStaticMarkup(render())).not.toContain(session.token);
	fetchMock.mockResolvedValueOnce(response({ signedOut: true }));
	const button = elements(render()).find((node) => node.type === 'button')!;
	(button.props.onClick as () => void)();
	await settle();
	expect(onSession).toHaveBeenLastCalledWith(null);
	expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
	expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toEqual({
		Authorization: 'Bearer ' + session.token
	});
});
