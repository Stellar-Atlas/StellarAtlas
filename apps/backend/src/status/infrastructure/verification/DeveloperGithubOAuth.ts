import { createHash } from 'node:crypto';
import { record } from './VerificationApplication.js';

export interface DeveloperGithubConfig {
	readonly origin: string;
	readonly clientId: string;
	readonly clientSecret: string;
}

export const developerAuthPath = '/v1/developer-auth';
const authorizeEndpoint = 'https://github.com/login/oauth/authorize';
const tokenEndpoint = 'https://github.com/login/oauth/access_token';
const userEndpoint = 'https://api.github.com/user';
const maxJsonBytes = 32 * 1024;

export function developerGithubOAuth(
	{ origin, clientId, clientSecret }: DeveloperGithubConfig,
	request: typeof fetch = fetch
) {
	const parsedOrigin = URL.parse(origin);
	if (
		parsedOrigin?.protocol !== 'https:' ||
		parsedOrigin.origin !== origin ||
		!/^[A-Za-z0-9_-]{1,128}$/.test(clientId) ||
		!/^[\x21-\x7e]{1,256}$/.test(clientSecret)
	)
		throw new Error('Invalid developer GitHub OAuth configuration');
	const redirectUri = origin + developerAuthPath + '/oauth/github/callback';
	return {
		authorizationUrl(state: string, verifier: string): string {
			const url = new URL(authorizeEndpoint);
			url.search = new URLSearchParams({
				client_id: clientId,
				redirect_uri: redirectUri,
				state,
				scope: '',
				code_challenge: createHash('sha256')
					.update(verifier)
					.digest('base64url'),
				code_challenge_method: 'S256'
			}).toString();
			return url.href;
		},
		async identify(code: string, verifier: string): Promise<string> {
			const signal = AbortSignal.timeout(8_000);
			const token = await readJson(
				await request(tokenEndpoint, {
					method: 'POST',
					redirect: 'error',
					signal,
					headers: { Accept: 'application/json' },
					body: new URLSearchParams({
						client_id: clientId,
						client_secret: clientSecret,
						code,
						redirect_uri: redirectUri,
						code_verifier: verifier
					})
				})
			);
			if (
				token.error !== undefined ||
				typeof token.access_token !== 'string' ||
				!/^[A-Za-z0-9_-]{1,256}$/.test(token.access_token) ||
				token.token_type !== 'bearer' ||
				token.scope !== ''
			)
				throw new Error('GitHub did not return an identity-only token');
			const user = await readJson(
				await request(userEndpoint, {
					redirect: 'error',
					signal,
					headers: {
						Accept: 'application/vnd.github+json',
						Authorization: 'Bearer ' + token.access_token,
						'User-Agent': 'StellarAtlas-Developer-Authentication'
					}
				})
			);
			if (
				user.type !== 'User' ||
				typeof user.id !== 'number' ||
				!Number.isSafeInteger(user.id) ||
				user.id < 1
			)
				throw new Error('GitHub did not return a user identity');
			return String(user.id);
		}
	};
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim();
	if (!response.ok || !response.body || mediaType !== 'application/json') {
		await response.body?.cancel();
		throw new Error('GitHub OAuth response is unavailable');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxJsonBytes) {
				await reader.cancel();
				throw new Error('GitHub OAuth response is too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return record(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')));
}
