import { buildEntityHref, type ExplorerFilters } from './explorer-analytics';

export function decodeExplorerIdentifier(value: string): string | null {
	try {
		const decoded = decodeURIComponent(value);
		if (
			!decoded ||
			decoded.includes('%') ||
			decoded.includes('/') ||
			decoded.includes(String.fromCharCode(92)) ||
			[...decoded].some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
			)
		)
			return null;
		return decoded;
	} catch {
		return null;
	}
}

const filterNames = new Set([
	'min_ledger',
	'max_ledger',
	'start_time',
	'end_time',
	'source_account',
	'type',
	'asset_code',
	'asset_issuer',
	'seller',
	'buyer',
	'offer_id',
	'selling_asset',
	'buying_asset',
	'operation_id',
	'ledger_sequence',
	'asset',
	'account',
	'from',
	'to',
	'event_topic',
	'transaction_hash',
	'contract_id',
	'min_amount_raw',
	'max_amount_raw'
]);
export function explorerRouteFilters(
	query: Readonly<Record<string, string | string[] | undefined>>
): ExplorerFilters {
	return Object.fromEntries(
		Object.entries(query).filter(
			([key, value]) =>
				filterNames.has(key) && typeof value === 'string' && value.length <= 512
		)
	) as ExplorerFilters;
}
export function resolveExplorerSearch(
	query: string,
	type = 'auto'
): string | null {
	const value = query.trim();
	if (!value) return null;
	const selected =
		type === 'auto'
			? /^C[A-Z2-7]{55}$/.test(value)
				? 'contract'
				: /^G[A-Z2-7]{55}$/.test(value)
					? 'account'
					: /^[a-fA-F0-9]{64}$/.test(value)
						? 'transaction'
						: value === 'native' || /^[^:]+:G[A-Z2-7]{55}$/.test(value)
							? 'asset'
							: /^\d+$/.test(value)
								? BigInt(value) > 4294967295n
									? 'operation'
									: 'ledger'
								: null
			: type;
	const collections: Readonly<Record<string, string>> = {
		contract: 'contracts',
		account: 'accounts',
		transaction: 'transactions',
		asset: 'assets',
		operation: 'operations',
		ledger: 'ledgers'
	};
	return selected && collections[selected]
		? buildEntityHref(collections[selected], value)
		: null;
}
export function normalizeExplorerTimes(
	filters: ExplorerFilters
): ExplorerFilters {
	return Object.fromEntries(
		Object.entries(filters).map(([key, value]) => {
			if ((key === 'start_time' || key === 'end_time') && value) {
				const date = new Date(value);
				if (Number.isNaN(date.getTime()))
					throw new Error('Enter a valid date and time.');
				return [key, date.toISOString()];
			}
			return [key, value];
		})
	);
}
export function localTimeInput(value: string): string {
	if (!value || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (part: number) => String(part).padStart(2, '0');
	return (
		date.getFullYear() +
		'-' +
		pad(date.getMonth() + 1) +
		'-' +
		pad(date.getDate()) +
		'T' +
		pad(date.getHours()) +
		':' +
		pad(date.getMinutes())
	);
}
