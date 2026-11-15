import { jest, expect, it, beforeEach, afterEach } from '@jest/globals';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HookHarness } from '../../blockchain/__tests__/asset-workspace-hook-harness';
import type { DeveloperSession } from '../../../api/developer-verification';
const harness = new HookHarness();
jest.unstable_mockModule('react', () => ({ ...React, useState: harness.useState, useRef: harness.useRef, useEffect: harness.useEffect }));
jest.unstable_mockModule('../developer-submissions.module.css', () => ({ default: {} }));
const { DeveloperSavedSubmissions } = await import('../developer-submissions');
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const send = jest.fn<typeof fetch>();
const expired = jest.fn();
const contract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const id = '12345678-1234-4234-8234-123456789abc';
const capability = () => Response.json({ available: true, verification: 'published_build_attestation', retentionDays: 30 });
const record = (status = 'checking', outcome = 'unavailable') => ({ id,
	submittedAt: '2026-11-15T12:00:00.000Z', expiresAt: '2026-12-15T12:00:00.000Z',
	networkPassphrase: 'Public Global Stellar Network ; September 2015',
	request: { contractId: contract, repository: 'owner/repo', commit: 'a'.repeat(40) }, status,
	result: status === 'checking' ? null : { status: outcome, evidence: null },
	contractOwnership: 'not_assessed', independentReproduction: 'not_assessed', securityAudit: 'not_assessed' });
let session: DeveloperSession;
let initialId: string | null;
type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!React.isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children as React.ReactNode)];
}
const render = () => harness.render(() => DeveloperSavedSubmissions({ session, initialId, onSessionExpired: expired }));
const settle = () => new Promise(resolve => setImmediate(resolve));
const html = () => renderToStaticMarkup(render());
function click(label: string) {
	const button = elements(render()).find(item => item.type === 'button' && item.props.children === label)!;
	expect(button).toBeDefined();
	(button.props.onClick as () => void)();
}
function fill() {
	for (const [index, value] of [contract, 'owner/repo', 'a'.repeat(40)].entries()) {
		const input = elements(render()).filter(item => item.type === 'input')[index]!;
		(input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
	}
}
function submit() {
	const form = elements(render()).find(item => item.type === 'form')!;
	(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => undefined });
}
beforeEach(() => {
	harness.reset(); send.mockReset(); expired.mockReset();
	jest.useFakeTimers({ doNotFake: ['setImmediate'] });
	session = { kind: 'signed-in', expiresAt: Date.now() + 60_000 };
	initialId = null;
	globalThis.fetch = send;
	Object.defineProperty(globalThis, 'window', { configurable: true,
		value: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout } });
});
afterEach(() => {
	harness.reset(); globalThis.fetch = originalFetch;
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
	else Reflect.deleteProperty(globalThis, 'window');
	jest.useRealTimers();
});

it('keeps disabled and signed-out saved-request states separate without submitting', async () => {
	send.mockResolvedValueOnce(new Response(null, { status: 404 }));
	render(); await settle();
	expect(html()).toContain('Public build checks remain available');
	expect(elements(render()).some(item => item.type === 'form')).toBe(false);
	harness.reset(); session = { kind: 'signed-out' };
	send.mockResolvedValueOnce(capability());
	render(); await settle();
	expect(html()).toContain('Sign in with GitHub to save a private');
	expect(send.mock.calls.every(([url]) => String(url).endsWith('/capabilities'))).toBe(true);
});

it('retains exact inputs and key after an ambiguous save, ignores duplicate clicks and stops on a terminal outcome', async () => {
	send.mockResolvedValueOnce(capability()).mockRejectedValueOnce(new TypeError('network lost'))
		.mockResolvedValueOnce(Response.json(record('completed')));
	render(); await settle(); fill(); submit(); submit(); await settle();
	expect(send).toHaveBeenCalledTimes(2);
	expect(html()).toContain('Retry same request');
	const first = send.mock.calls[1]![1]!;
	expect(first.signal).toBeDefined();
	jest.advanceTimersByTime(30_000);
	expect(first.signal!.aborted).toBe(false);
	click('Retry same request'); await settle();
	const retry = send.mock.calls[2]![1]!;
	expect(retry.body).toBe(first.body);
	expect(retry.headers).toEqual(first.headers);
	expect(html()).toContain('Build check unavailable');
	expect(html()).toContain('not ownership of this contract or repository');
	expect(html()).toContain('independent source reproduction and a security audit are not assessed');
	jest.advanceTimersByTime(120_000); await settle(); render();
	expect(send).toHaveBeenCalledTimes(3);
});

it('polls only owner reads, honors Retry-After and never retries POST automatically', async () => {
	send.mockResolvedValueOnce(capability()).mockResolvedValueOnce(Response.json(record(), { status: 201 }))
		.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '60' } }))
		.mockResolvedValueOnce(Response.json(record('completed', 'not_published')));
	render(); await settle(); fill(); submit(); await settle(); render();
	jest.advanceTimersByTime(5000); await settle(); render();
	expect(send.mock.calls[2]![0]).toBe('/v1/developer-auth/submissions/' + id);
	expect(elements(render()).find(item => item.props.children === 'Refresh saved result')?.props.disabled).toBe(true);
	jest.advanceTimersByTime(59_000); await settle(); render();
	expect(send).toHaveBeenCalledTimes(3);
	jest.advanceTimersByTime(1000); render();
	click('Refresh saved result'); await settle();
	expect(html()).toContain('No published build attestation found');
	jest.advanceTimersByTime(120_000); await settle(); render();
	expect(send.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
	expect(send).toHaveBeenCalledTimes(4);
});

it('aborts an in-flight owner read on unmount and reports session expiry', async () => {
	send.mockResolvedValueOnce(capability()).mockResolvedValueOnce(Response.json(record()))
		.mockImplementationOnce(() => new Promise(() => undefined));
	render(); await settle(); fill(); submit(); await settle(); render();
	jest.advanceTimersByTime(5000); await settle();
	const signal = send.mock.calls[2]![1]!.signal!;
	expect(signal.aborted).toBe(false);
	harness.reset();
	expect(signal.aborted).toBe(true);
	jest.advanceTimersByTime(60_000); await settle();
	expect(send).toHaveBeenCalledTimes(3);
	send.mockResolvedValueOnce(capability()).mockResolvedValueOnce(new Response(null, { status: 401 }));
	render(); await settle(); fill(); submit(); await settle();
	expect(expired).toHaveBeenCalledTimes(1);
});

it('opens a saved-request link only after sign-in and capability checks, without a new submission', async () => {
	initialId = id;
	session = { kind: 'signed-out' };
	send.mockResolvedValueOnce(capability());
	render(); await settle(); render();
	expect(send).toHaveBeenCalledTimes(1);
	harness.reset();
	session = { kind: 'signed-in', expiresAt: Date.now() + 60_000 };
	send.mockResolvedValueOnce(capability()).mockResolvedValueOnce(Response.json(record('completed', 'not_published')));
	render(); await settle(); render(); await settle();
	expect(html()).toContain('Open this saved request');
	expect(html()).toContain('Only available to the GitHub account that saved it');
	expect(send.mock.calls[2]![0]).toBe('/v1/developer-auth/submissions/' + id);
	expect(send.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
	submit();
	expect(send).toHaveBeenCalledTimes(3);
});

it('keeps a long-running saved check pending beyond two minutes without a fresh POST or key', async () => {
	session = { kind: 'signed-in', expiresAt: Date.now() + 20 * 60_000 };
	send.mockResolvedValueOnce(capability()).mockImplementation(() => Promise.resolve(Response.json(record())));
	render(); await settle(); fill(); submit(); await settle(); render();
	for (let step = 0; step < 5; step++) {
		jest.advanceTimersByTime(30_000); await settle(); render();
	}
	expect(html()).toContain('Saved · checking published build evidence');
	expect(html()).toContain('30 days after the check finishes');
	expect(html()).not.toContain('Start a new request');
	expect(send.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
	expect(send.mock.calls.slice(2).every(([url]) => url === '/v1/developer-auth/submissions/' + id)).toBe(true);
});
