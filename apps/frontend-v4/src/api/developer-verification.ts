const prefix = '/v1/developer-auth';
const callback = prefix + '/oauth/github/callback';
const authorization = 'https://github.com/login/oauth/authorize';

export type SignInReturn = 'complete' | 'rejected' | 'unavailable';
export type DeveloperSession =
	| { readonly kind: 'disabled' | 'signed-out' | 'unavailable' }
	| { readonly kind: 'signed-in'; readonly expiresAt: number };

export function readDeveloperSignInReturn(value: unknown): SignInReturn | null {
	return value === 'complete' || value === 'rejected' || value === 'unavailable' ? value : null;
}

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

async function request(
	path: string, method: 'GET' | 'POST' | 'DELETE', signal: AbortSignal, send: typeof fetch
): Promise<Response> {
	return send(prefix + path, {
		method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
		referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' },
		signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
	});
}

export async function loadDeveloperSession(
	signal: AbortSignal, send: typeof fetch = fetch
): Promise<DeveloperSession> {
	try {
		const capabilities = await request('/capabilities', 'GET', signal, send);
		if (capabilities.status === 404) return { kind: 'disabled' };
		if (capabilities.status !== 200) return { kind: 'unavailable' };
		const config = object(await capabilities.json());
		if (config.available === false) return { kind: 'disabled' };
		if (config.available !== true || config.provider !== 'github') return { kind: 'unavailable' };
		const response = await request('/session', 'GET', signal, send);
		if (response.status === 401) return { kind: 'signed-out' };
		if (response.status !== 200) return { kind: 'unavailable' };
		const session = object(await response.json());
		const value = session.expiresAt;
		if (session.provider !== 'github' || typeof value !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
			return { kind: 'unavailable' };
		const expiresAt = Date.parse(value);
		if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== value)
			return { kind: 'unavailable' };
		return expiresAt > Date.now() ? { kind: 'signed-in', expiresAt } : { kind: 'signed-out' };
	} catch {
		return { kind: 'unavailable' };
	}
}

function githubAuthorizationUrl(value: unknown, origin: string): string | null {
	if (typeof value !== 'string' || value.length > 2048) return null;
	const url = new URL(value);
	if (url.origin + url.pathname !== authorization || url.username || url.password || url.hash)
		return null;
	const params = url.searchParams;
	const required = {
		client_id: /^[A-Za-z0-9_-]{1,128}$/,
		redirect_uri: null,
		state: /^[A-Za-z0-9_-]{43}$/,
		scope: /^$/,
		code_challenge: /^[A-Za-z0-9_-]{43}$/,
		code_challenge_method: /^S256$/
	};
	if (params.size !== Object.keys(required).length) return null;
	for (const [name, pattern] of Object.entries(required)) {
		const [item, ...duplicate] = params.getAll(name);
		if (item === undefined || duplicate.length ||
			(pattern ? !pattern.test(item) : item !== origin + callback)) return null;
	}
	return url.href;
}

type AuthError = { readonly kind: 'unavailable' | 'wrong-origin' | 'busy' };

async function wrongOrigin(response: Response): Promise<boolean> {
	return response.status === 403 && object(await response.json()).code === 'origin_mismatch';
}

export async function startDeveloperSignIn(
	origin: string, signal: AbortSignal, send: typeof fetch = fetch
): Promise<{ readonly kind: 'redirect'; readonly url: string } | AuthError> {
	try {
		const response = await request('/oauth/github/start', 'POST', signal, send);
		if (await wrongOrigin(response)) return { kind: 'wrong-origin' };
		if (response.status === 429) return { kind: 'busy' };
		if (response.status !== 200) return { kind: 'unavailable' };
		const url = githubAuthorizationUrl(object(await response.json()).authorizationUrl, origin);
		return url ? { kind: 'redirect', url } : { kind: 'unavailable' };
	} catch {
		return { kind: 'unavailable' };
	}
}

export async function endDeveloperSession(
	signal: AbortSignal, send: typeof fetch = fetch
): Promise<'signed-out' | 'wrong-origin' | 'unavailable'> {
	try {
		const response = await request('/session', 'DELETE', signal, send);
		return response.status === 204 ? 'signed-out'
			: await wrongOrigin(response) ? 'wrong-origin' : 'unavailable';
	} catch {
		return 'unavailable';
	}
}
