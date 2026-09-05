export interface TransferActivity {
	id: string;
	ledgerSequence: number;
	closedAt: string;
	transactionHash: string;
	transactionId: string;
	operationId: string | null;
	from: string | null;
	to: string | null;
	toMuxed: string | null;
	asset: {
		id: string;
		type: string;
		code: string | null;
		issuer: string | null;
	};
	contractId: string;
	eventTopic: string;
	amountRaw: string;
	amountScale: number | null;
}
export interface TransferActivityPage {
	transfers: TransferActivity[];
	limit: number;
	nextCursor: string | null;
	watermark: {
		minimumLedger: number;
		maximumLedger: number;
		observedAt: string;
		coverage: string;
	};
	elapsedMilliseconds: number;
}
export type TransferFilters = Record<string, string>;

export function buildTransferActivityPath(
	filters: TransferFilters,
	after?: string
): string {
	const params = new URLSearchParams();
	for (const [key, raw] of Object.entries(filters)) {
		const value = raw.trim();
		if (!value) continue;
		if (key === 'start_time' || key === 'end_time') {
			const date = new Date(value);
			if (!Number.isFinite(date.getTime()))
				throw new Error('Enter a valid date and time.');
			params.set(key, date.toISOString());
		} else {
			params.set(key, value);
		}
	}
	let path = '/v1/analytics/activity/transfers';
	if (params.has('account')) {
		path =
			'/v1/analytics/accounts/' +
			encodeURIComponent(params.get('account')!) +
			'/activity/transfers';
		params.delete('account');
	} else if (params.has('asset')) {
		path =
			'/v1/analytics/assets/' +
			encodeURIComponent(params.get('asset')!) +
			'/activity/transfers';
		params.delete('asset');
	}
	params.set('limit', '10');
	if (after) params.set('after', after);
	return path + '?' + params.toString();
}

export function formatTransferAmount(
	raw: string,
	scale: number | null
): string {
	if (
		scale === null ||
		!Number.isInteger(scale) ||
		scale < 0 ||
		scale > 38 ||
		!/^-?\d+$/.test(raw)
	) {
		return raw + ' raw units';
	}
	const negative = raw.startsWith('-');
	const digits = (negative ? raw.slice(1) : raw).padStart(scale + 1, '0');
	if (scale === 0) return raw;
	const whole = digits.slice(0, -scale);
	const fraction = digits.slice(-scale).replace(/0+$/, '');
	return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}
function transfer(value: unknown): value is TransferActivity {
	return (
		record(value) &&
		typeof value.id === 'string' &&
		typeof value.ledgerSequence === 'number' &&
		Number.isSafeInteger(value.ledgerSequence) &&
		typeof value.closedAt === 'string' &&
		typeof value.transactionHash === 'string' &&
		typeof value.transactionId === 'string' &&
		nullableString(value.operationId) &&
		nullableString(value.from) &&
		nullableString(value.to) &&
		nullableString(value.toMuxed) &&
		typeof value.contractId === 'string' &&
		typeof value.eventTopic === 'string' &&
		typeof value.amountRaw === 'string' &&
		/^-?\d+$/.test(value.amountRaw) &&
		(value.amountScale === null || typeof value.amountScale === 'number') &&
		record(value.asset) &&
		typeof value.asset.id === 'string' &&
		typeof value.asset.type === 'string' &&
		nullableString(value.asset.code) &&
		nullableString(value.asset.issuer)
	);
}
export function parseTransferActivityPage(
	value: unknown
): TransferActivityPage {
	if (
		!record(value) ||
		!Array.isArray(value.transfers) ||
		!value.transfers.every(transfer) ||
		typeof value.limit !== 'number' ||
		!nullableString(value.nextCursor) ||
		!record(value.watermark) ||
		typeof value.watermark.minimumLedger !== 'number' ||
		typeof value.watermark.maximumLedger !== 'number' ||
		typeof value.watermark.observedAt !== 'string' ||
		typeof value.watermark.coverage !== 'string' ||
		typeof value.elapsedMilliseconds !== 'number'
	) {
		throw new Error('The analytics API returned an invalid transfer response.');
	}
	return value as unknown as TransferActivityPage;
}
