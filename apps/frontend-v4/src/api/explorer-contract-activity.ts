import {
	recordValue,
	requestExplorerJson,
	type EntityRecord,
	type ExplorerFilters
} from './explorer-analytics';

export type ContractActivityTab = 'events' | 'state';
export interface ContractActivityPage {
	readonly tab: ContractActivityTab;
	readonly rows: readonly EntityRecord[];
	readonly nextPosition: string | null;
	readonly coverage: EntityRecord;
	readonly watermark: EntityRecord;
}
const pageSize = 10;

export function contractActivityPath(
	contractId: string,
	tab: ContractActivityTab,
	filters: ExplorerFilters,
	position = ''
): string {
	const query = new URLSearchParams({ limit: String(pageSize) });
	const names = [
		'min_ledger',
		'max_ledger',
		...(tab === 'events'
			? [
					'transaction_hash',
					'start_time',
					'end_time',
					'type_code',
					'successful',
					'in_successful_contract_call'
				]
			: ['ledger_key_hash', 'durability', 'deleted'])
	];
	for (const name of names) {
		const value = filters[name]?.trim();
		if (value) query.set(name, value);
	}
	if (tab === 'events') {
		query.set('view', 'typed');
		if (position) query.set('after', position);
	} else {
		if (
			position &&
			(!/^[0-9]+$/.test(position) || !Number.isSafeInteger(Number(position)))
		)
			throw new Error('Invalid contract state page.');
		query.set('offset', position || '0');
	}
	return (
		'/v1/analytics/contracts/' +
		encodeURIComponent(contractId) +
		'/' +
		tab +
		'?' +
		query
	);
}

export async function requestContractActivity(
	path: string,
	contractId: string,
	tab: ContractActivityTab,
	position: string,
	signal: AbortSignal
): Promise<ContractActivityPage> {
	return parseContractActivityPage(
		await requestExplorerJson(path, signal),
		contractId,
		tab,
		position
	);
}

export function parseContractActivityPage(
	value: unknown,
	contractId: string,
	tab: ContractActivityTab,
	position = ''
): ContractActivityPage {
	const data = recordValue(value);
	const items: unknown = tab === 'events' ? data.items : data.rows;
	if (
		!Array.isArray(items) ||
		items.length > pageSize ||
		items.some((row) => Object.keys(recordValue(row)).length === 0)
	)
		throw new Error(
			'The data service returned an invalid contract activity page.'
		);
	const rows = items.map(recordValue);
	let nextPosition: string | null = null;
	if (tab === 'events') {
		if (
			data.contractId !== contractId ||
			(data.nextCursor !== null &&
				(typeof data.nextCursor !== 'string' ||
					!data.nextCursor ||
					data.nextCursor === position))
		)
			throw new Error(
				'The data service returned invalid contract-event pagination.'
			);
		for (const row of rows) {
			if (
				row.contractId !== contractId ||
				typeof row.id !== 'string' ||
				typeof row.transactionHash !== 'string' ||
				typeof row.closedAt !== 'string' ||
				typeof row.ledgerSequence !== 'number' ||
				!Number.isSafeInteger(row.ledgerSequence) ||
				row.ledgerSequence < 1 ||
				row.ledgerSequence > 4294967295 ||
				typeof row.topicsJson !== 'string' ||
				typeof row.dataJson !== 'string' ||
				typeof row.successful !== 'boolean' ||
				typeof row.inSuccessfulContractCall !== 'boolean'
			)
				throw new Error(
					'The data service returned an invalid typed contract event.'
				);
			try {
				JSON.parse(row.topicsJson);
				// The retained SCVal decoder represents a void return as literal text.
				// Preserve it without rejecting all other events on this page.
				if (row.dataJson !== 'void') JSON.parse(row.dataJson);
			} catch {
				throw new Error(
					'The data service returned invalid decoded event JSON.'
				);
			}
		}
		const watermark = recordValue(data.watermark);
		if (
			![watermark.minimumLedger, watermark.maximumLedger].every(
				(number) =>
					typeof number === 'number' &&
					Number.isSafeInteger(number) &&
					number >= 0
			) ||
			Number(watermark.minimumLedger) > Number(watermark.maximumLedger) ||
			watermark.coverage !== 'ingested-only'
		)
			throw new Error(
				'The data service returned an invalid contract-event window.'
			);
		nextPosition = data.nextCursor as string | null;
	} else if (data.nextOffset !== null && data.nextOffset !== undefined) {
		if (
			typeof data.nextOffset !== 'number' ||
			!Number.isSafeInteger(data.nextOffset) ||
			data.nextOffset <= Number(position || 0)
		)
			throw new Error('The data service returned invalid state pagination.');
		nextPosition = String(data.nextOffset);
	}
	return {
		tab,
		rows,
		nextPosition,
		coverage: recordValue(data.coverage),
		watermark: recordValue(data.watermark)
	};
}
