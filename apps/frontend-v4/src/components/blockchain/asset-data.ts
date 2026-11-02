import { entityText, recordValue } from '../../api/explorer-analytics';
import type { Asset } from './explorer-asset-types';

export function normalizeAssetRef(value?: string): string | undefined {
	if (!value?.includes('%')) return value;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Classify presentation only; the API remains authoritative for identity/checksum resolution. */
export function isAssetDiscoveryReference(reference: string | undefined): boolean {
	return !reference || reference !== 'native' && !reference.includes(':') && !/^C[A-Z2-7]{55}$/.test(reference);
}

export function parseAsset(value: unknown): Asset {
	const data = recordValue(value);
	const kind = entityText(data, 'kind');
	const id = entityText(data, 'id');
	if (!id || !['native', 'classic', 'contract'].includes(kind))
		throw new Error('Invalid asset returned by the data service.');
	const number = (input: unknown) =>
		typeof input === 'number' && Number.isSafeInteger(input)
			? input
			: undefined;
	return {
		id,
		kind: kind as Asset['kind'],
		code: entityText(data, 'code') || undefined,
		issuer: entityText(data, 'issuer') || undefined,
		contractId: entityText(data, 'contractId') || undefined,
		observed: typeof data.observed === 'boolean' ? data.observed : undefined,
		name: entityText(data, 'name') || undefined,
		logoUrl: entityText(data, 'logoUrl') || undefined,
		firstObservedLedger: number(data.firstObservedLedger),
		lastObservedLedger: number(data.lastObservedLedger),
		firstObservedAt: entityText(data, 'firstObservedAt') || undefined,
		lastObservedAt: entityText(data, 'lastObservedAt') || undefined
	};
}
