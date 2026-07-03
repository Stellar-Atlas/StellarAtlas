export { frontendCacheTags, type FrontendCacheTag } from 'shared';

export interface FrontendRevalidationConfig {
	readonly frontendBaseUrl?: string;
	readonly frontendRevalidateToken?: string;
}

export function triggerFrontendRevalidation(
	config: FrontendRevalidationConfig,
	tags: readonly string[]
): void {
	if (!config.frontendBaseUrl || !config.frontendRevalidateToken) return;

	let revalidateUrl: URL;
	try {
		revalidateUrl = new URL('/api/revalidate', config.frontendBaseUrl);
	} catch {
		return;
	}

	void fetch(revalidateUrl, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.frontendRevalidateToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ tags }),
		signal: AbortSignal.timeout(1500)
	}).catch(() => undefined);
}
