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
const { VerificationReviewPanel, VerificationReview } =
	await import('../verification-review');
const { AtlasIdentityView, IdentityLookup, AccountAtlasIdentity } =
	await import('../account-atlas-identity');
const { readAtlasIdentity, readReviewQueue } =
	await import('../../../api/atlas-verification');
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
	submittedAt: '2026-11-07T20:00:00.000Z',
	control: {
		network: 'mainnet',
		address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		method: 'stellar-account-authority',
		verifiedAt: '2026-11-07T20:00:00.000Z'
	},
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

const reviewerSession = () => ({
	token: 'r'.repeat(43),
	address: application.address,
	network: 'mainnet' as const,
	expiresAt: new Date(Date.now() + 60_000).toISOString()
});
function click(tree: React.ReactNode, label: string) {
	const button = elements(tree).find(
		(node) => node.type === 'button' && node.props.children === label
	)!;
	(button.props.onClick as () => void)();
}
it('shows only target-bound approved Atlas identity, never imported or pending evidence', () => {
	const publicRecord = {
		source: 'stellaratlas/verification',
		publisher: 'StellarAtlas',
		status: 'verified',
		address: application.address,
		network: 'mainnet',
		name: 'Approved identity',
		website: 'https://example.org/',
		revision: 2,
		verifiedAt: '2026-11-07T20:00:00.000Z',
		supportingEvidence: 'Private evidence'
	};
	const identity = readAtlasIdentity(
		{ verification: publicRecord },
		'mainnet',
		application.address
	)!;
	expect(identity).not.toHaveProperty('supportingEvidence');
	const html = renderToStaticMarkup(
		<AtlasIdentityView state={{ status: 'loaded', identity }} />
	);
	expect(html).toContain('Verified by Atlas');
	expect(html).toContain('Approved identity');
	expect(html).not.toContain('Private evidence');
	for (const patch of [
		{ status: 'pending' },
		{ source: 'stellar.expert' },
		{ network: 'testnet' },
		{ website: 'javascript:alert(1)' },
		{ verifiedAt: '2026-02-30T00:00:00.000Z' }
	])
		expect(() =>
			readAtlasIdentity(
				{ verification: { ...publicRecord, ...patch } },
				'mainnet',
				application.address
			)
		).toThrow();
	expect(
		renderToStaticMarkup(
			<AtlasIdentityView state={{ status: 'unavailable' }} />
		)
	).not.toContain('No approved');
	expect(
		renderToStaticMarkup(
			<AtlasIdentityView state={{ status: 'loaded', identity: null }} />
		)
	).toContain('No approved Atlas identity');
});
it('makes one disposable public lookup for the focused account and does not treat errors as absence', async () => {
	fetchMock.mockResolvedValue(response({ error: 'private failure' }, 503));
	const draw = () =>
		harness.render(() =>
			IdentityLookup({ address: application.address, network: 'mainnet' })
		);
	draw();
	await settle();
	expect(renderToStaticMarkup(draw())).toContain('lookup unavailable');
	draw();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock.mock.calls[0]?.[0]).toBe(
		'/v1/account-verification/mainnet/' + application.address
	);
	expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
	const signal = fetchMock.mock.calls[0]?.[1]?.signal;
	harness.reset();
	expect(signal?.aborted).toBe(true);
	expect(
		AccountAtlasIdentity({ address: 'invalid', network: 'mainnet' })
	).toBeNull();
});
it('keeps reviewer controls and private evidence absent until the server grants queue access', async () => {
	fetchMock.mockResolvedValue(response({ error: 'private failure' }, 403));
	const session = reviewerSession(),
		expired = jest.fn();
	const draw = () =>
		harness.render(() =>
			VerificationReviewPanel({ session, onExpired: expired })
		);
	expect(fetchMock).not.toHaveBeenCalled();
	click(draw(), 'Load pending queue');
	await settle();
	const html = renderToStaticMarkup(draw());
	expect(html).toContain('Reviewer access');
	expect(html).not.toContain('Private evidence</p>');
	expect(html).not.toContain('Save decision');
	expect(html).not.toContain('Load application');
	expect(html).not.toContain('private failure');
	expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
		Authorization: 'Bearer ' + session.token
	});
	expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
	expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
});
it('sends a confirmed, revision-bound approval and removes stale controls on conflict without retry', async () => {
	fetchMock
		.mockResolvedValueOnce(response({ items: [application], nextCursor: null }))
		.mockResolvedValueOnce(response({}, 409));
	const session = reviewerSession();
	const draw = () =>
		harness.render(() =>
			VerificationReviewPanel({ session, onExpired: () => undefined })
		);
	click(draw(), 'Load pending queue');
	await settle();
	click(draw(), 'Review');
	expect(renderToStaticMarkup(draw())).toContain('Private evidence');
	const select = elements(draw()).find((node) => node.type === 'select')!;
	(select.props.onChange as (e: { target: { value: string } }) => void)({
		target: { value: 'approved' }
	});
	const reason = elements(draw()).find((node) => node.type === 'textarea')!;
	(reason.props.onChange as (e: { target: { value: string } }) => void)({
		target: { value: 'Identity evidence checked' }
	});
	const form = () =>
		elements(draw())
			.filter((node) => node.type === 'form')
			.at(-1)!;
	const submit = () =>
		(form().props.onSubmit as (e: { preventDefault: () => void }) => void)({
			preventDefault: () => undefined
		});
	submit();
	expect(fetchMock).toHaveBeenCalledTimes(1);
	for (const checkbox of elements(draw()).filter(
		(node) => node.props.type === 'checkbox'
	))
		(checkbox.props.onChange as (e: { target: { checked: boolean } }) => void)({
			target: { checked: true }
		});
	submit();
	await settle();
	expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
		revision: 1,
		state: 'approved',
		reason: 'Identity evidence checked',
		identityEvidenceReviewed: true
	});
	expect(fetchMock.mock.calls[1]?.[0]).toBe(
		'/v1/account-verification/applications/' + application.id + '/decisions'
	);
	const html = renderToStaticMarkup(draw());
	expect(html).toContain('application changed');
	expect(html).not.toContain('Record decision');
	expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('distinguishes disabled review from unknown availability and rejects oversized or malformed queues', async () => {
	fetchMock.mockResolvedValue(response({ available: false }));
	const draw = () => harness.render(() => VerificationReview());
	draw();
	await settle();
	const html = renderToStaticMarkup(draw());
	expect(html).toContain('not enabled');
	expect(html).not.toContain('Authenticate');
	expect(() =>
		readReviewQueue({
			items: Array(21).fill(application),
			nextCursor: application.id
		})
	).toThrow();
	expect(() =>
		readReviewQueue({ items: [application], nextCursor: application.id })
	).toThrow();
	expect(() =>
		readReviewQueue({
			items: [{ ...application, state: 'approved' }],
			nextCursor: null
		})
	).toThrow();
});
