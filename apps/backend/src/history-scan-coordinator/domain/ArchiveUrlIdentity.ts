import { normalizeHistoryArchiveRootUrl } from 'shared';

export function parseHistoryArchiveUrl(url: string): string | null {
	return normalizeHistoryArchiveRootUrl(url);
}

export function getHistoryArchiveUrlIdentity(url: string): string | null {
	const parsedUrl = parseHistoryArchiveUrl(url);
	return parsedUrl === null ? null : parsedUrl.toLowerCase();
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
