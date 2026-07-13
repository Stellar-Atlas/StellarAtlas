import { normalizeHistoryArchiveRootUrl } from 'shared';

export function parseHistoryArchiveUrl(url: string): string | null {
	return normalizeHistoryArchiveRootUrl(url);
}

export function getHistoryArchiveUrlIdentity(url: string): string | null {
	return parseHistoryArchiveUrl(url);
}

export function getPublicHistoryArchiveUrlIdentity(value: string): string {
	const parsed = parsePublicIdentityUrl(value);
	if (parsed === null) return '[redacted]';
	const path = parsed.pathname.replace(/\/+$/, '');
	return `${parsed.host}${path === '' || path === '/' ? '' : path}`;
}

export function uniqueHistoryArchiveUrls(urls: readonly string[]): string[] {
	const uniqueUrls = new Map<string, string>();
	for (const url of urls) {
		const parsedUrl = parseHistoryArchiveUrl(url);
		if (parsedUrl === null) continue;

		const identity = getHistoryArchiveUrlIdentity(parsedUrl);
		if (identity !== null && !uniqueUrls.has(identity)) {
			uniqueUrls.set(identity, parsedUrl);
		}
	}

	return Array.from(uniqueUrls.values());
}

function parsePublicIdentityUrl(value: string): URL | null {
	const normalized = parseHistoryArchiveUrl(value);
	const candidate = normalized ?? normalizeHostOnlyIdentity(value);
	if (candidate === null) return null;
	try {
		const url = new URL(candidate);
		return url.username === '' && url.password === '' ? url : null;
	} catch {
		return null;
	}
}

function normalizeHostOnlyIdentity(value: string): string | null {
	if (
		value.trim() !== value ||
		value === '' ||
		value.length > 2_048 ||
		value.includes('://') ||
		value.includes('#') ||
		/\s/u.test(value) ||
		hasControlCharacter(value)
	) {
		return null;
	}
	return `https://${value}`;
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
	});
}
