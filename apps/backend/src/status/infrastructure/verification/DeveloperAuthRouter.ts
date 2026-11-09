import { createHash, randomBytes } from 'node:crypto';
import express, {
	type CookieOptions,
	type Request,
	type Router
} from 'express';
import {
	developerGithubOAuth,
	type DeveloperGithubConfig
} from './DeveloperGithubOAuth.js';

interface GithubFlow {
	readonly stateHash: string;
	readonly browserHash: string;
	readonly verifier: string;
	readonly expiresAt: number;
}

interface DeveloperSession {
	readonly providerUserId: string;
	readonly expiresAt: number;
}

interface DeveloperApplicant {
	readonly subjectId: string;
	readonly expiresAt: string;
}

// The deployment adapter must use a shared store across API processes.
// issueFlow enforces an atomic shared admission limit and prunes expired state.
// consumeFlow atomically deletes and returns only an unexpired state with the
// exact browser binding. Sessions must be capacity-bounded and pruned at expiry.
// Session tokens are persisted only as hashes.
export interface DeveloperAuthStore {
	issueFlow(flow: GithubFlow): Promise<boolean>;
	consumeFlow(
		stateHash: string,
		browserHash: string
	): Promise<GithubFlow | null>;
	createSession(tokenHash: string, session: DeveloperSession): Promise<void>;
	session(tokenHash: string): Promise<DeveloperSession | null>;
	revokeSession(tokenHash: string): Promise<void>;
}

const flowLifetimeMs = 10 * 60_000;
const sessionLifetimeMs = 20 * 60_000;
const flowCookie = '__Host-atlas-developer-oauth';
const sessionCookie = '__Host-atlas-developer-session';
const cookieOptions: CookieOptions = {
	httpOnly: true,
	secure: true,
	sameSite: 'lax',
	path: '/'
};
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const secret = () => randomBytes(32).toString('base64url');
const hash = (value: string) =>
	createHash('sha256').update(value).digest('hex');

export function developerAuthRouter(
	config: DeveloperGithubConfig,
	store: DeveloperAuthStore,
	request: typeof fetch = fetch
): {
	readonly router: Router;
	applicant(req: Request): Promise<DeveloperApplicant | null>;
} {
	const github = developerGithubOAuth(config, request);
	const { origin } = config;
	const router = express.Router();
	let activeExchanges = 0;
	router.use((_req, res, next) => {
		res.set('Cache-Control', 'private, no-store');
		res.set('Referrer-Policy', 'no-referrer');
		next();
	});

	router.post('/oauth/github/start', async (req, res) => {
		if (req.get('Origin') !== origin) {
			res.status(403).json({ code: 'origin_mismatch' });
			return;
		}
		const state = secret();
		const browser = secret();
		const verifier = secret();
		try {
			const accepted = await store.issueFlow({
				stateHash: hash(state),
				browserHash: hash(browser),
				verifier,
				expiresAt: Date.now() + flowLifetimeMs
			});
			if (!accepted) {
				res.set('Retry-After', '60').status(429).json({ code: 'sign_in_busy' });
				return;
			}
			res.cookie(flowCookie, browser, {
				...cookieOptions,
				maxAge: flowLifetimeMs
			});
			res.json({ authorizationUrl: github.authorizationUrl(state, verifier) });
		} catch {
			res.status(503).json({ code: 'sign_in_unavailable' });
		}
	});

	router.get('/oauth/github/callback', async (req, res) => {
		const { state, code, error } = req.query;
		const browser = readCookie(req, flowCookie);
		const redirect = (result: 'complete' | 'rejected' | 'unavailable') =>
			res.redirect(303, origin + '/developer/verification?signIn=' + result);
		const denied = error === 'access_denied' && code === undefined;
		if (
			typeof state !== 'string' ||
			!secretPattern.test(state) ||
			!browser ||
			(!denied &&
				(error !== undefined ||
					typeof code !== 'string' ||
					!/^[A-Za-z0-9_-]{1,256}$/.test(code)))
		) {
			redirect('rejected');
			return;
		}
		if (activeExchanges >= 2) {
			redirect('unavailable');
			return;
		}
		activeExchanges++;
		try {
			const flow = await store.consumeFlow(hash(state), hash(browser));
			if (!flow || flow.expiresAt <= Date.now()) {
				redirect('rejected');
				return;
			}
			res.clearCookie(flowCookie, cookieOptions);
			if (denied || typeof code !== 'string') {
				redirect('rejected');
				return;
			}
			const providerUserId = await github.identify(code, flow.verifier);
			const token = secret();
			const expiresAt = Date.now() + sessionLifetimeMs;
			await store.createSession(hash(token), { providerUserId, expiresAt });
			res.cookie(sessionCookie, token, {
				...cookieOptions,
				maxAge: sessionLifetimeMs
			});
			redirect('complete');
		} catch {
			redirect('unavailable');
		} finally {
			activeExchanges--;
		}
	});

	async function applicant(req: Request) {
		if (
			req.method !== 'GET' &&
			req.method !== 'HEAD' &&
			req.get('Origin') !== origin
		)
			return null;
		const token = readCookie(req, sessionCookie);
		const session = token ? await store.session(hash(token)) : null;
		if (!session || session.expiresAt <= Date.now()) return null;
		return {
			subjectId: 'github:' + session.providerUserId,
			expiresAt: new Date(session.expiresAt).toISOString()
		};
	}

	router.get('/session', async (req, res) => {
		try {
			const session = await applicant(req);
			if (!session) {
				res.status(401).json({ code: 'sign_in_required' });
				return;
			}
			res.json({ provider: 'github', expiresAt: session.expiresAt });
		} catch {
			res.status(503).json({ code: 'sign_in_unavailable' });
		}
	});

	router.delete('/session', async (req, res) => {
		if (req.get('Origin') !== origin) {
			res.status(403).json({ code: 'origin_mismatch' });
			return;
		}
		try {
			const token = readCookie(req, sessionCookie);
			if (token) await store.revokeSession(hash(token));
			res.clearCookie(sessionCookie, cookieOptions).status(204).end();
		} catch {
			res.status(503).json({ code: 'sign_in_unavailable' });
		}
	});
	return { router, applicant };
}

function readCookie(req: Request, name: string): string | null {
	const header = req.get('Cookie');
	if (!header || header.length > 8192) return null;
	const prefix = name + '=';
	const cookies = header
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part.startsWith(prefix));
	const value = cookies[0]?.slice(prefix.length);
	return cookies.length === 1 && value && secretPattern.test(value)
		? value
		: null;
}
