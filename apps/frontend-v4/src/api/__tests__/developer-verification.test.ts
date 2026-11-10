import { expect, it, jest } from '@jest/globals';
import {
	endDeveloperSession, loadDeveloperSession, readDeveloperSignInReturn, startDeveloperSignIn
} from '../developer-verification';

const origin = 'https://atlas.example';
const signal = new AbortController().signal;
const options = {
	credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
};
const json = (data: unknown, status = 200) => Response.json(data, { status });
const available = () => json({ available: true, provider: 'github' });

it('treats the callback as a hint and reads session only after enabled capabilities', async () => {
	expect(readDeveloperSignInReturn('complete')).toBe('complete');
	expect(readDeveloperSignInReturn(['complete', 'rejected'])).toBeNull();
	expect(readDeveloperSignInReturn('token=private')).toBeNull();
	const disabled = jest.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
	expect(await loadDeveloperSession(signal, disabled)).toEqual({ kind: 'disabled' });
	expect(disabled).toHaveBeenCalledTimes(1);
	expect(disabled).toHaveBeenCalledWith('/v1/developer-auth/capabilities', expect.objectContaining({
		...options, method: 'GET'
	}));

	const absent = jest.fn<typeof fetch>().mockResolvedValueOnce(available())
		.mockResolvedValueOnce(json({ code: 'sign_in_required' }, 401));
	expect(await loadDeveloperSession(signal, absent)).toEqual({ kind: 'signed-out' });
	expect(absent).toHaveBeenNthCalledWith(2, '/v1/developer-auth/session',
		expect.objectContaining({ ...options, method: 'GET' }));
	const expiresAt = Date.now() + 60_000;
	const valid = jest.fn<typeof fetch>().mockResolvedValueOnce(available())
		.mockResolvedValueOnce(json({ provider: 'github', expiresAt: new Date(expiresAt).toISOString() }));
	expect(await loadDeveloperSession(signal, valid)).toEqual({ kind: 'signed-in', expiresAt });
});

it('starts OAuth only through the Atlas endpoint and accepts only its GitHub authorization redirect', async () => {
	const url = new URL('https://github.com/login/oauth/authorize');
	url.search = new URLSearchParams({
		client_id: 'atlas-fixture',
		redirect_uri: origin + '/v1/developer-auth/oauth/github/callback',
		state: 'A'.repeat(43), scope: '',
		code_challenge: 'B'.repeat(43), code_challenge_method: 'S256'
	}).toString();
	const valid = jest.fn<typeof fetch>().mockResolvedValue(json({ authorizationUrl: url.href }));
	expect(await startDeveloperSignIn(origin, signal, valid)).toEqual({ kind: 'redirect', url: url.href });
	expect(valid).toHaveBeenCalledWith('/v1/developer-auth/oauth/github/start',
		expect.objectContaining({ ...options, method: 'POST' }));
	for (const authorizationUrl of [
		url.href.replace('github.com', 'github.com.example'),
		url.href.replace('atlas.example', 'different.example'),
		url.href + '&state=' + 'C'.repeat(43),
		url.href.replace('scope=', 'scope=repo'),
		url.href + '#fragment'
	]) {
		const invalid = jest.fn<typeof fetch>().mockResolvedValue(json({ authorizationUrl }));
		expect(await startDeveloperSignIn(origin, signal, invalid)).toEqual({ kind: 'unavailable' });
	}
});

it('does not declare sign-out complete until the session endpoint accepts it', async () => {
	const deny = jest.fn<typeof fetch>().mockResolvedValue(json({ code: 'origin_mismatch' }, 403));
	expect(await endDeveloperSession(signal, deny)).toBe('wrong-origin');
	const done = jest.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
	expect(await endDeveloperSession(signal, done)).toBe('signed-out');
	expect(done).toHaveBeenCalledWith('/v1/developer-auth/session',
		expect.objectContaining({ ...options, method: 'DELETE' }));
});
