import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';
import { isAssetDiscoveryReference, normalizeAssetRef } from './asset-data';
import { assetDiscoveryHref, readAssetDiscoverySelection } from './asset-discovery-page';

/** Detail filters belong to their tabs; only a validated directory origin owns an asset search. */
export function assetDirectoryLink(params: Pick<URLSearchParams, 'get'>): string {
	const origin = sanitizeExplorerReturnTo(params.get('return_to'));
	if (!origin) return '/explorer/assets';
	const url = new URL(origin, 'https://explorer.invalid');
	const parts = url.pathname.split('/');
	const reference = parts.length === 4 ? normalizeAssetRef(parts[3]) : undefined;
	const directory = url.pathname === '/explorer/assets' ||
		parts.length === 4 && parts[1] === 'explorer' && parts[2] === 'assets' && isAssetDiscoveryReference(reference);
	if (directory) {
		try {
			return assetDiscoveryHref('', readAssetDiscoverySelection(url.searchParams, reference));
		} catch {
			// A malformed directory origin must not recreate the rejected search.
			return '/explorer/assets';
		}
	}
	return '/explorer/assets?' + new URLSearchParams({ return_to: origin });
}
