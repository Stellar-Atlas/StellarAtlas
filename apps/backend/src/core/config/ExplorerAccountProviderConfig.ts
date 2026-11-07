import { isIP } from 'node:net';
import { err, ok, type Result } from 'neverthrow';

export interface ExplorerAccountProviderConfig {
	readonly url: string;
	readonly hostname: string;
}

/** Operator opt-in only; never selected from a request or after a native failure. */
export function parseExplorerAccountProviderConfig(value: string | undefined): Result<ExplorerAccountProviderConfig | undefined, Error> {
	if (value === undefined) return ok(undefined);
	try {
		const input = /^https:\/\/[^/?#@%\\\s]+(\/[^?#\\\s]*)?$/.exec(value);
		if (!input) throw new Error();
		const url = new URL(value);
		const host = url.hostname;
		if (url.username || url.password || url.port || isIP(host) || host.length > 253 ||
			!host.includes('.') || host.endsWith('.') ||
			!host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
			/\.(?:localhost|local|internal|lan)$/.test(host) ||
			/%|\/(?:\.|\.\.)(?:\/|$)|\/\//.test(input[1] ?? '/')) throw new Error();
		if (!url.pathname.endsWith('/')) url.pathname += '/';
		return ok({ url: url.href, hostname: host });
	} catch {
		return err(new Error('EXPLORER_ACCOUNT_PROVIDER_URL must be an explicit HTTPS public-host base without credentials, port, query or fragment'));
	}
}
