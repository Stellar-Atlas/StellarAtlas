import { publicArchiveRootIdentity } from 'shared';
import { isClassicAccount } from './classic-account';

const radarOrigin = 'https://radar.withobsrvr.com';

export function radarArchiveReportUrl(archiveUrl: string): string | null {
	const root = publicArchiveRootIdentity(archiveUrl);
	if (root === null || new TextEncoder().encode(root).length > 2048)
		return null;
	return radarOrigin + '/api/v1/history-scan/' + encodeURIComponent(root);
}

export function radarValidatorUrl(
	node: { readonly publicKey: string; readonly isValidator: boolean } | null
): string | null {
	return node?.isValidator && isClassicAccount(node.publicKey)
		? radarOrigin + '/nodes/' + node.publicKey
		: null;
}
