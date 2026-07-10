import type {
	PublicExplorerContract,
	PublicTransactionLookup
} from '@api/types';

export function formatTransactionSource(
	source: PublicTransactionLookup['source']
): string {
	if (source === 'horizon') return 'Stellar public API';
	return source;
}

export function formatDate(value: string): string {
	if (value.length === 0) return 'Unknown';
	return new Date(value).toLocaleString();
}

export function formatExplorerSource(source: string): string {
	if (source === 'horizon') return 'Stellar public API';
	if (source === 'local') return 'StellarAtlas local index';
	if (source === 'rpc') return 'Soroban RPC';
	return source.replaceAll('_', ' ');
}

export function formatTransactionHash(hash: string): string {
	if (hash.length <= 24) return hash;
	return `${hash.slice(0, 12)}...${hash.slice(-10)}`;
}

export function formatContractReadiness(
	contract: PublicExplorerContract
): string {
	if (contract.readiness === 'planned') return 'Planned';
	if (contract.readiness === 'configured_not_probed') return 'Not probed';
	return contract.status;
}

export async function writeClipboardText(value: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}

	const field = document.createElement('textarea');
	field.value = value;
	field.setAttribute('readonly', 'true');
	field.style.position = 'fixed';
	field.style.inset = '0';
	field.style.opacity = '0';
	document.body.append(field);
	field.select();
	document.execCommand('copy');
	field.remove();
}
