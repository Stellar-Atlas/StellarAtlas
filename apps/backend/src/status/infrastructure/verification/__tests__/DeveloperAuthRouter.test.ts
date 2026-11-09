import { createHash } from 'node:crypto';
import express from 'express';
import supertest from 'supertest';
import {
	developerAuthRouter,
	type DeveloperAuthStore
} from '../DeveloperAuthRouter.js';
import { developerAuthPath } from '../DeveloperGithubOAuth.js';

const origin = 'https://atlas.example';
const config = { origin, clientId: 'test-client', clientSecret: 'test-only' };
const startPath = developerAuthPath + '/oauth/github/start';
const callbackPath = developerAuthPath + '/oauth/github/callback';
const sessionPath = developerAuthPath + '/session';
const signedIn = origin + '/developer/verification?signIn=complete';
const rejected = origin + '/developer/verification?signIn=rejected';
const unavailable = origin + '/developer/verification?signIn=unavailable';
const hash = (value: string) =>
	createHash('sha256').update(value).digest('hex');

function fixture() {
	const flows = new Map<
		string,
		Parameters<DeveloperAuthStore['issueFlow']>[0]
	>();
	const sessions = new Map<
		string,
		Parameters<DeveloperAuthStore['createSession']>[1]
	>();
	const store = {
		issueFlow: jest.fn<
			ReturnType<DeveloperAuthStore['issueFlow']>,
			Parameters<DeveloperAuthStore['issueFlow']>
		>(async (flow) => {
			flows.set(flow.stateHash, flow);
			return true;
		}),
		async consumeFlow(stateHash, browserHash) {
			const flow = flows.get(stateHash);
			if (
				!flow ||
				flow.browserHash !== browserHash ||
				flow.expiresAt <= Date.now()
			)
				return null;
			flows.delete(stateHash);
			return flow;
		},
		async createSession(tokenHash, session) {
			sessions.set(tokenHash, session);
		},
		async session(tokenHash) {
			return sessions.get(tokenHash) ?? null;
		},
		async revokeSession(tokenHash) {
			sessions.delete(tokenHash);
		}
	} satisfies DeveloperAuthStore;
	const provider = jest.fn<
		ReturnType<typeof fetch>,
		Parameters<typeof fetch>
	>();
	const app = () => {
		const { router, applicant } = developerAuthRouter(config, store, provider);
		return express()
			.use(developerAuthPath, router)
			.post('/submission-test', async (req, res) => {
				const session = await applicant(req);
				res.status(session ? 200 : 401).json(session);
			});
	};
	const begin = async () => {
		const result = await supertest(app())
			.post(startPath)
			.set('Origin', origin)
			.expect('Cache-Control', 'private, no-store')
			.expect(200);
		const cookie = String(result.headers['set-cookie'][0]);
		expect(cookie).toMatch(/; Path=\/;.*; HttpOnly; Secure; SameSite=Lax$/);
		expect(cookie).not.toContain('Domain=');
		const authorization = new URL(result.body.authorizationUrl);
		const state = authorization.searchParams.get('state')!;
		return { authorization, state, browser: cookie.split(';')[0]! };
	};
	return { flows, sessions, store, provider, app, begin };
}

function token(scope = '') {
	return Response.json({
		access_token: 'test-provider-token',
		token_type: 'bearer',
		scope
	});
}

it('authenticates one browser-bound PKCE flow and issues a revocable Atlas session across routers', async () => {
	const { flows, sessions, provider, app, begin } = fixture();
	provider.mockResolvedValueOnce(token()).mockResolvedValueOnce(
		Response.json({
			id: 1234567,
			type: 'User',
			login: 'renameable',
			email: 'ignored@example.com'
		})
	);
	const { authorization, state, browser } = await begin();
	expect(authorization.origin + authorization.pathname).toBe(
		'https://github.com/login/oauth/authorize'
	);
	expect(authorization.searchParams.get('redirect_uri')).toBe(
		origin + callbackPath
	);
	expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
	expect(authorization.searchParams.get('scope')).toBe('');
	const verifier = flows.get(hash(state))?.verifier;
	expect(verifier).toBeDefined();
	expect(authorization.searchParams.get('code_challenge')).toBe(
		createHash('sha256').update(verifier!).digest('base64url')
	);
	expect(authorization.href).not.toContain(config.clientSecret);

	const callback = supertest(app());
	const result = await callback
		.get(callbackPath)
		.set('Cookie', browser)
		.query({ state, code: 'single-use-code' })
		.expect('Referrer-Policy', 'no-referrer')
		.expect('Location', signedIn)
		.expect(303);
	const sessionCookie = (result.headers['set-cookie'] as string[]).find(
		(value) => value.startsWith('__Host-atlas-developer-session=')
	)!;
	expect(sessionCookie).toMatch(
		/; Path=\/;.*; HttpOnly; Secure; SameSite=Lax$/
	);
	expect(sessionCookie).not.toContain('test-provider-token');
	const session = sessionCookie.split(';')[0]!;
	const stored = sessions.get(hash(session.split('=')[1]!));
	expect(stored).toEqual({
		providerUserId: '1234567',
		expiresAt: expect.any(Number)
	});
	expect(provider.mock.calls[0]?.[0]).toBe(
		'https://github.com/login/oauth/access_token'
	);
	expect(provider.mock.calls[0]?.[1]).toMatchObject({
		method: 'POST',
		redirect: 'error'
	});
	expect(
		(provider.mock.calls[0]?.[1]?.body as URLSearchParams).get('code_verifier')
	).toBe(verifier);
	expect(provider.mock.calls[1]?.[0]).toBe('https://api.github.com/user');
	expect(provider.mock.calls[1]?.[1]).toMatchObject({
		redirect: 'error',
		headers: { Authorization: 'Bearer test-provider-token' }
	});
	expect(flows.size).toBe(0);
	await callback
		.get(callbackPath)
		.set('Cookie', browser)
		.query({ state, code: 'replay' })
		.expect('Location', rejected)
		.expect(303);
	expect(provider).toHaveBeenCalledTimes(2);

	const api = supertest(app());
	await api
		.get(sessionPath)
		.set('Cookie', session)
		.expect(200)
		.expect({
			provider: 'github',
			expiresAt: new Date(stored!.expiresAt).toISOString()
		});
	await api.post('/submission-test').set('Cookie', session).expect(401);
	const principal = await api
		.post('/submission-test')
		.set('Cookie', session)
		.set('Origin', origin)
		.expect(200);
	expect(principal.body.subjectId).toBe('github:1234567');
	await api
		.delete(sessionPath)
		.set('Cookie', session)
		.set('Origin', 'https://other.example')
		.expect(403);
	await api
		.delete(sessionPath)
		.set('Cookie', session)
		.set('Origin', origin)
		.expect(204);
	await api.get(sessionPath).set('Cookie', session).expect(401);
});

it('rejects cross-origin starts, wrong browser binding and shared admission saturation before contacting GitHub', async () => {
	const { flows, store, provider, app, begin } = fixture();
	const api = supertest(app());
	await api.post(startPath).expect(403);
	await api.post(startPath).set('Origin', 'https://other.example').expect(403);
	expect(store.issueFlow).not.toHaveBeenCalled();
	const { state, browser } = await begin();
	await api
		.get(callbackPath)
		.set('Cookie', '__Host-atlas-developer-oauth=' + 'a'.repeat(43))
		.query({ state, code: 'other-browser' })
		.expect('Location', rejected)
		.expect(303);
	expect(flows.size).toBe(1);
	await api
		.get(callbackPath)
		.set('Cookie', browser)
		.query({ state, error: 'access_denied' })
		.expect('Location', rejected)
		.expect(303);
	expect(flows.size).toBe(0);
	store.issueFlow.mockResolvedValueOnce(false);
	await api
		.post(startPath)
		.set('Origin', origin)
		.expect('Retry-After', '60')
		.expect(429);
	expect(provider).not.toHaveBeenCalled();
});

it.each([
	['broader scope', () => token('repo')],
	['oversized reply', () => Response.json({ data: 'a'.repeat(33 * 1024) })],
	[
		'provider failure',
		() => Response.json({ error: 'temporarily_unavailable' }, { status: 503 })
	]
])(
	'rejects %s before retrieving identity or creating a session',
	async (_label, reply) => {
		const { sessions, provider, app, begin } = fixture();
		provider.mockResolvedValueOnce(reply());
		const { state, browser } = await begin();
		await supertest(app())
			.get(callbackPath)
			.set('Cookie', browser)
			.query({ state, code: 'code' })
			.expect('Location', unavailable)
			.expect(303);
		expect(provider).toHaveBeenCalledTimes(1);
		expect(sessions.size).toBe(0);
	}
);

it('rejects an identity without a stable numeric user ID', async () => {
	const { sessions, provider, app, begin } = fixture();
	provider
		.mockResolvedValueOnce(token())
		.mockResolvedValueOnce(Response.json({ type: 'User', login: 'name-only' }));
	const { state, browser } = await begin();
	await supertest(app())
		.get(callbackPath)
		.set('Cookie', browser)
		.query({ state, code: 'code' })
		.expect('Location', unavailable)
		.expect(303);
	expect(sessions.size).toBe(0);
});

it('rejects expired flows and sessions', async () => {
	const { flows, sessions, provider, app, begin } = fixture();
	const { state, browser } = await begin();
	const flow = flows.get(hash(state))!;
	flows.set(hash(state), { ...flow, expiresAt: Date.now() - 1 });
	const api = supertest(app());
	await api
		.get(callbackPath)
		.set('Cookie', browser)
		.query({ state, code: 'expired' })
		.expect('Location', rejected)
		.expect(303);
	expect(provider).not.toHaveBeenCalled();
	const token = 'a'.repeat(43);
	sessions.set(hash(token), {
		providerUserId: '1234567',
		expiresAt: Date.now() - 1
	});
	await api
		.get(sessionPath)
		.set('Cookie', '__Host-atlas-developer-session=' + token)
		.expect(401);
});

it.each([
	'http://atlas.example',
	'https://atlas.example/return',
	'https://atlas.example?bad=1'
])('rejects a noncanonical HTTPS origin %s', (value) => {
	const { store } = fixture();
	expect(() =>
		developerAuthRouter({ ...config, origin: value }, store)
	).toThrow('Invalid developer GitHub OAuth configuration');
});
