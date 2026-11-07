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
jest.unstable_mockModule('../verification-application.module.css', () => ({
	default: {}
}));
const { VerificationApplication, readApplication } =
	await import('../verification-application');
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
const application = {
	id: '00000001-0000-0000-0000-000000000001',
	state: 'pending',
	revision: 1,
	network: 'mainnet',
	address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
	name: 'Example',
	website: 'https://example.org/',
	supportingEvidence: 'Private evidence',
	review: null
};
const response = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!React.isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children as React.ReactNode)];
}
const render = () => harness.render(() => VerificationApplication());
const settle = () => new Promise((resolve) => setImmediate(resolve));
beforeEach(() => {
	harness.reset();
	fetchMock.mockReset();
	globalThis.fetch = fetchMock;
});
afterEach(() => {
	harness.reset();
	globalThis.fetch = originalFetch;
});

it('keeps forms absent until availability is confirmed, makes one check and aborts on unmount', async () => {
	fetchMock.mockResolvedValue(response({ available: false }));
	expect(renderToStaticMarkup(render())).toContain(
		'Checking application availability'
	);
	await settle();
	const html = renderToStaticMarkup(render());
	expect(html).toContain('applications are not open yet');
	expect(html).not.toContain('<form');
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const signal = fetchMock.mock.calls[0]?.[1]?.signal;
	harness.reset();
	expect(signal?.aborted).toBe(true);
});
it('submits public fields plus private supporting text and displays pending status without auto-retry', async () => {
	fetchMock.mockImplementation(async (url) =>
		String(url).endsWith('/capabilities')
			? response({ available: true })
			: response(application, 201)
	);
	render();
	await settle();
	for (const [length, value] of [
		[56, application.address],
		[120, application.name],
		[512, application.website],
		[4000, application.supportingEvidence]
	] as const) {
		const field = elements(render()).find(
			(node) => node.props.maxLength === length
		)!;
		(field.props.onChange as (event: { target: { value: string } }) => void)({
			target: { value }
		});
	}
	const form = elements(render()).filter((node) => node.type === 'form')[1]!;
	(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
		preventDefault: () => undefined
	});
	await settle();
	expect(fetchMock).toHaveBeenCalledTimes(2);
	const init = fetchMock.mock.calls[1]?.[1];
	expect(init?.credentials).toBe('same-origin');
	expect(init?.cache).toBe('no-store');
	expect(JSON.parse(String(init?.body))).toEqual({
		network: 'mainnet',
		address: application.address,
		name: application.name,
		website: application.website,
		supportingEvidence: application.supportingEvidence
	});
	const html = renderToStaticMarkup(render());
	expect(html).toContain('Application status: pending');
	expect(html).toContain('no public verification badge yet');
	expect(html).not.toContain('Submit for review');
});
it('leaves authentication and account-control errors actionable without showing a success', async () => {
	fetchMock.mockImplementation(async (url) =>
		String(url).endsWith('/capabilities')
			? response({ available: true })
			: response({ error: 'private server detail' }, 403)
	);
	render();
	await settle();
	const form = elements(render()).filter((node) => node.type === 'form')[1]!;
	(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
		preventDefault: () => undefined
	});
	await settle();
	const html = renderToStaticMarkup(render());
	expect(html).toContain('current account-control check is required');
	expect(html).not.toContain('private server detail');
	expect(html).not.toContain('Application saved');
	expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('rejects malformed application status before presentation', () => {
	expect(readApplication(application)?.state).toBe('pending');
	for (const patch of [
		{ state: 'verified' },
		{ revision: 0 },
		{ id: 'malformed' },
		{ supportingEvidence: 'x'.repeat(4001) },
		{ network: 'unknown' }
	])
		expect(readApplication({ ...application, ...patch })).toBeNull();
});
