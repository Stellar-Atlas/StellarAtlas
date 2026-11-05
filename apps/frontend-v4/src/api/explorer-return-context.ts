const EXPLORER_BASE = 'https://explorer-return.invalid';
const MAX_RETURN_TO_LENGTH = 4096;
const ASSET_CATALOGUE_PATH = '/explorer/assets';

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

function isAssetInvestigation(url: URL): boolean {
	const tabs = url.searchParams.getAll('tab');
	return /^\/explorer\/assets\/[^/]+$/.test(url.pathname) &&
		tabs.length === 1 && (tabs[0] === 'transfers' || tabs[0] === 'markets');
}

function assetCatalogueReturnTo(value: string | null): string | null {
	const url = value === null ? null : explorerUrl(value);
	if (url?.pathname !== ASSET_CATALOGUE_PATH) return null;
	const path = relativeExplorerPath(url);
	return path.length <= MAX_RETURN_TO_LENGTH ? path : null;
}

function nestedAssetCatalogue(url: URL): string | null {
	if (!isAssetInvestigation(url)) return null;
	const values = url.searchParams.getAll('return_to');
	return values.length === 1 ? assetCatalogueReturnTo(values[0]!) : null;
}

/** A detail can return through one pair report, one asset Markets tab and one catalogue. */
function nestedPairAsset(url: URL): string | null {
	if (url.pathname !== '/explorer/markets') return null;
	const values = url.searchParams.getAll('return_to');
	if (values.length !== 1) return null;
	const asset = explorerUrl(values[0]!);
	if (!asset || !isAssetInvestigation(asset) || asset.searchParams.get('tab') !== 'markets') return null;
	return sanitizeExplorerReturnTo(values[0]);
}

function attachReturnTo(url: URL, origin: string): string {
	url.searchParams.set('return_to', origin);
	return `${url.pathname}${url.search}`;
}

/** Carry just one catalogue hop, or return straight to it if both pages cannot fit. */
export function withAssetCatalogueReturnTo(
	activity: string,
	origin: string | null
): string {
	const catalogue = assetCatalogueReturnTo(origin);
	if (catalogue === null) return activity;
	const url = explorerUrl(activity);
	if (url === null || !isAssetInvestigation(url)) return catalogue;
	relativeExplorerPath(url);
	const nested = attachReturnTo(url, catalogue);
	return nested.length <= MAX_RETURN_TO_LENGTH ? nested : catalogue;
}

export function sanitizeExplorerReturnTo(
	value: string | null | undefined
): string | null {
	if (value == null) return null;
	const url = explorerUrl(value);
	if (url === null) return null;
	const pairAsset = nestedPairAsset(url);
	const catalogue = pairAsset === null ? nestedAssetCatalogue(url) : null;
	const path = relativeExplorerPath(url);
	if (path.length > MAX_RETURN_TO_LENGTH) return null;
	const parent = pairAsset ?? catalogue;
	if (parent === null) return path;
	const nested = attachReturnTo(url, parent);
	return nested.length <= MAX_RETURN_TO_LENGTH ? nested : catalogue ?? path;
}

export function withExplorerReturnTo(
	destination: string,
	origin: string | null | undefined,
	includeCollection = false
): string {
	const destinationUrl = explorerUrl(destination);
	if (destinationUrl === null) return destination;

	const pathSegments = destinationUrl.pathname.split('/');
	if (
		(pathSegments.length !== 4 && !(includeCollection && pathSegments.length === 3)) ||
		pathSegments[0] !== '' ||
		pathSegments[1] !== 'explorer' ||
		!pathSegments[2] ||
		(pathSegments.length === 4 && !pathSegments[3])
	) {
		return destination;
	}

	const cleanDestination = relativeExplorerPath(destinationUrl);
	const sanitizedOrigin = sanitizeExplorerReturnTo(origin);
	if (sanitizedOrigin === null) return cleanDestination;

	const linked = attachReturnTo(destinationUrl, sanitizedOrigin);
	if (linked.length <= MAX_RETURN_TO_LENGTH) return linked;
	const originUrl = new URL(sanitizedOrigin, EXPLORER_BASE);
	if (originUrl.pathname === '/explorer/markets') {
		// If an encoded nested origin cannot fit, prefer Back to the exact pair page.
		const pairOnly = attachReturnTo(destinationUrl, relativeExplorerPath(originUrl));
		return pairOnly.length <= MAX_RETURN_TO_LENGTH ? pairOnly : cleanDestination;
	}
	// A catalogue fallback may already be flat before the destination is encoded.
	if (originUrl.pathname === ASSET_CATALOGUE_PATH) return cleanDestination;
	const catalogue = nestedAssetCatalogue(originUrl);
	if (catalogue === null) return linked;
	const fallback = attachReturnTo(destinationUrl, catalogue);
	return fallback.length <= MAX_RETURN_TO_LENGTH ? fallback : cleanDestination;
}
