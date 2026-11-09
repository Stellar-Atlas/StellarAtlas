import {
	createCipheriv,
	createDecipheriv,
	createHash,
	hkdfSync,
	randomBytes
} from 'node:crypto';
import express, {
	type CookieOptions,
	type Request,
	type Router
} from 'express';
import { rateLimit } from 'express-rate-limit';
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
const sealedCookiePattern = /^[A-Za-z0-9_-]{80}$/;
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
	const cookieKey = Buffer.from(
		hkdfSync(
			'sha256',
			config.clientSecret,
			'',
			'atlas-developer-cookies-v1',
			32
		)
	);
	const router = express.Router();
	const inputs = new WeakMap<
		Request,
		{
			readonly query: Request['query'];
			readonly browser: string | null;
			readonly session: string | null;
		}
	>();
	let activeExchanges = 0;
	function sealCookie(name: string, value: string): string {
		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', cookieKey, nonce);
		cipher.setAAD(Buffer.from(name));
		const ciphertext = Buffer.concat([
			cipher.update(Buffer.from(value, 'base64url')),
			cipher.final()
		]);
		return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
			'base64url'
		);
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
		if (cookies.length !== 1 || !value || !sealedCookiePattern.test(value))
			return null;
		const bytes = Buffer.from(value, 'base64url');
		try {
			const decipher = createDecipheriv(
				'aes-256-gcm',
				cookieKey,
				bytes.subarray(0, 12)
			);
			decipher.setAAD(Buffer.from(name));
			decipher.setAuthTag(bytes.subarray(12, 28));
			return Buffer.concat([
				decipher.update(bytes.subarray(28)),
				decipher.final()
			]).toString('base64url');
		} catch {
			return null;
		}
	}

	router.use((req, res, next) => {
		inputs.set(req, {
			query: req.query,
			browser: readCookie(req, flowCookie),
			session: readCookie(req, sessionCookie)
		});
		// Keep callback and cookie credentials out of downstream request
		// diagnostics. Ingress must already redact its own logs and telemetry.
		req.query = {};
		req.originalUrl = req.originalUrl.split('?', 1)[0]!;
		req.url = req.url.split('?', 1)[0]!;
		delete req.headers.cookie;
		delete req.headers.authorization;
		for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
			const name = req.rawHeaders[index]?.toLowerCase();
			if (name === 'cookie' || name === 'authorization')
				req.rawHeaders.splice(index, 2);
		}
		res.set('Cache-Control', 'private, no-store');
		res.set('Referrer-Policy', 'no-referrer');
		next();
	});

	router.get('/capabilities', (_req, res) => {
		res.json({ available: true, provider: 'github' });
	});

	router.post(
		'/oauth/github/start',
		(req, res, next) => {
			if (req.get('Origin') !== origin) {
				res.status(403).json({ code: 'origin_mismatch' });
				return;
			}
			next();
		},
		rateLimit({
			windowMs: 60_000,
			limit: 60,
			// Bound calls to shared admission without trusting forwarded client IPs.
			keyGenerator: () => 'developer-oauth-start',
			legacyHeaders: false,
			handler: (_req, res) => {
				res.set('Retry-After', '60').status(429).json({ code: 'sign_in_busy' });
			}
		}),
		async (_req, res) => {
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
					res
						.set('Retry-After', '60')
						.status(429)
						.json({ code: 'sign_in_busy' });
					return;
				}
				res.cookie(flowCookie, sealCookie(flowCookie, browser), {
					httpOnly: true,
					secure: true,
					sameSite: 'lax',
					path: '/',
					maxAge: flowLifetimeMs
				});
				res.json({
					authorizationUrl: github.authorizationUrl(state, verifier)
				});
			} catch {
				res.status(503).json({ code: 'sign_in_unavailable' });
			}
		}
	);

	router.head('/oauth/github/callback', (_req, res) => {
		res.set('Allow', 'GET').status(405).end();
	});
	router.get('/oauth/github/callback', async (req, res) => {
		const input = inputs.get(req);
		const { state, code, error } = input?.query ?? {};
		const browser = input?.browser;
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
			res.cookie(sessionCookie, sealCookie(sessionCookie, token), {
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				path: '/',
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
		const input = inputs.get(req);
		const token = input ? input.session : readCookie(req, sessionCookie);
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
			const token = inputs.get(req)?.session;
			if (token) await store.revokeSession(hash(token));
			res.clearCookie(sessionCookie, cookieOptions).status(204).end();
		} catch {
			res.status(503).json({ code: 'sign_in_unavailable' });
		}
	});
	return { router, applicant };
}
