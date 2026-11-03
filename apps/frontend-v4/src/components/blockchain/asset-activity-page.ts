import { parseTransferActivityPage, type TransferActivityPage } from '../../api/transfer-activity';
import type { Asset } from './explorer-asset-types';

export type AssetActivitySelection = { before: number | undefined; after: string | null };
const activityKeys = ['asset_activity_for', 'asset_activity_before', 'asset_activity_after'] as const;
const validBefore = (value: number): boolean => Number.isSafeInteger(value) && value >= 2 && value <= 2_147_483_647;
const validAfter = (value: string): boolean => /^[A-Za-z0-9_-]{1,2048}$/.test(value);

export function readAssetActivitySelection(params: URLSearchParams, asset: Asset): AssetActivitySelection {
	if (activityKeys.every(key => !params.has(key))) return { before: asset.lastObservedLedger, after: null };
	const end = params.get('asset_activity_before'), after = params.get('asset_activity_after');
	if (activityKeys.some(key => params.getAll(key).length > 1) ||
		params.get('asset_activity_for') !== asset.id || (end === null && after === null) ||
		(end !== null && (!/^[1-9]\d{0,9}$/.test(end) || !validBefore(Number(end)))) ||
		(after !== null && !validAfter(after))) throw new Error('Invalid or unrelated activity selection. Open the latest activity to start again.');
	return { before: end === null ? undefined : Number(end), after };
}

export function assetActivityHref(path: string, search: string, asset: Asset, selection: AssetActivitySelection | null, hash = ''): string {
	const params = new URLSearchParams(search);
	for (const key of activityKeys) params.delete(key);
	if (selection && (selection.before !== undefined || selection.after !== null)) {
		params.set('asset_activity_for', asset.id);
		if (selection.before !== undefined) params.set('asset_activity_before', String(selection.before));
		if (selection.after !== null) params.set('asset_activity_after', selection.after);
		readAssetActivitySelection(params, asset);
	}
	return path + (params.size ? '?' + params.toString() : '') + hash;
}

export function assetActivityPath(asset: Asset, before: number | undefined, after: string | null): string {
	const params = new URLSearchParams({limit:'25'});
	params.set(asset.kind === 'contract' ? 'contract_id' : 'asset', asset.kind === 'contract' ? asset.contractId || asset.id : asset.id);
	if (before !== undefined) {
		if (!validBefore(before)) throw new Error('Invalid activity ledger window.');
		params.set('min_ledger',String(Math.max(2,before-2047))); params.set('max_ledger',String(before));
	}
	if (after !== null) {
		if (!validAfter(after)) throw new Error('Invalid transfer continuation.');
		params.set('after',after);
	}
	return '/v1/activity/transfers?' + params;
}
export function parseAssetActivityPage(value: unknown, asset: Asset, before: number | undefined, after: string | null): TransferActivityPage {
	assetActivityPath(asset,before,after);
	if (value !== null && typeof value === 'object' && 'transfers' in value && Array.isArray(value.transfers) && value.transfers.length > 25) throw new Error('The API exceeded the transfer page limit.');
	const page=parseTransferActivityPage(value), wm=page.watermark;
	if (page.limit !== 25 || wm.coverage !== 'ingested-only' ||
		![wm.minimumLedger,wm.maximumLedger].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2_147_483_647) ||
		!Number.isFinite(Date.parse(wm.observedAt)) || (before !== undefined && wm.maximumLedger > before) ||
		(before !== undefined && wm.minimumLedger !== (wm.maximumLedger === 0 ? 0 : Math.max(2,before-2047))) ||
		(page.nextCursor !== null && (!/^[A-Za-z0-9_-]{1,2048}$/.test(page.nextCursor) || page.nextCursor===after || !page.transfers.length)) ||
		!Number.isFinite(page.elapsedMilliseconds) || page.elapsedMilliseconds < 0) throw new Error('Invalid transfer page or coverage.');
	const ids=new Set<string>();
	for(const row of page.transfers) {
		if(ids.has(row.id) || !row.id || row.ledgerSequence < wm.minimumLedger || row.ledgerSequence > wm.maximumLedger ||
			(asset.kind === 'contract' ? row.contractId !== (asset.contractId || asset.id) : row.asset.id !== asset.id) ||
			!/^[a-f0-9]{64}$/i.test(row.transactionHash) || !Number.isFinite(Date.parse(row.closedAt)) ||
			!/^(?:0|-?[1-9][0-9]{0,38})$/.test(row.amountRaw) || BigInt(row.amountRaw)<-(1n<<127n) || BigInt(row.amountRaw)>(1n<<127n)-1n ||
			row.amountScale !== (['native','credit_alphanum4','credit_alphanum12'].includes(row.asset.type)?7:null)) throw new Error('Invalid or unrelated asset transfer.');
		ids.add(row.id);
	}
	return page;
}
