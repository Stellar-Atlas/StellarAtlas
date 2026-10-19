const EXPLORER_BASE = 'https://explorer-return.invalid';
const MAX_RETURN_TO_LENGTH = 4096;

function explorerUrl(value: string): URL | null {
	if (
		value.length > MAX_RETURN_TO_LENGTH ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\\u0000-\u001f\u007f]/.test(value) ||
		/%(?![0-9a-f]{2})/i.test(value) ||
		/%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
	) {
		return null;
	}

	try {
		const url = new URL(value, EXPLORER_BASE);
		if (
			url.origin !== EXPLORER_BASE ||
			(url.pathname !== '/explorer' && !url.pathname.startsWith('/explorer/'))
		) {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

function relativeExplorerPath(url: URL): string {
	url.hash = '';
	url.searchParams.delete('return_to');
	return `${url.pathname}${url.search}`;
}

export function sanitizeExplorerReturnTo(
	value: string | null | undefined
): string | null {
	if (value == null) return null;
	const url = explorerUrl(value);
	return url === null ? null : relativeExplorerPath(url);
}

export function withExplorerReturnTo(
	destination: string,
	origin: string | null | undefined
): string {
	const destinationUrl = explorerUrl(destination);
	if (destinationUrl === null) return destination;

	const pathSegments = destinationUrl.pathname.split('/');
	if (
		pathSegments.length !== 4 ||
		pathSegments[0] !== '' ||
		pathSegments[1] !== 'explorer' ||
		!pathSegments[2] ||
		!pathSegments[3]
	) {
		return destination;
	}

	const cleanDestination = relativeExplorerPath(destinationUrl);
	const sanitizedOrigin = sanitizeExplorerReturnTo(origin);
	if (sanitizedOrigin === null) return cleanDestination;

	destinationUrl.searchParams.set('return_to', sanitizedOrigin);
	destinationUrl.hash = '';
	return `${destinationUrl.pathname}${destinationUrl.search}`;
}
