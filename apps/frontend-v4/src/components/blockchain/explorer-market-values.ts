import { entityText, recordValue } from '../../api/explorer-analytics';

/** Group supplied decimal text without rounding it through a JS number. */
export function formatMarketAmount(value: string): string {
	if (!value.trim()) return '—';
	const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
	if (!match) return value;
	const fraction = match[3]?.replace(/0+$/, '') ?? '';
	return match[1] + BigInt(match[2]!).toLocaleString('en-US') + (fraction ? '.' + fraction : '');
}

export function marketAssetLabel(value: unknown): string {
	const asset = recordValue(value);
	const id = entityText(asset, 'id');
	return id === 'native' ? 'XLM' : entityText(asset, 'code') || id || 'Unknown asset';
}
