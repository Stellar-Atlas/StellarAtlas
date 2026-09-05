import type { HubbleTransfer } from './HubbleTransferContracts.js';
import type { HubbleTransferPosition } from './HubbleTransferCursor.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

export function mapHubbleTransfer(
	row: Readonly<Record<string, unknown>>
): HubbleTransfer {
	const position = transferPosition(row);
	const type = text(row, 'asset_type');
	const closedAt = text(row, 'closed_at');
	const date = new Date(
		closedAt.endsWith('Z') ? closedAt : closedAt.replace(' ', 'T') + 'Z'
	);
	if (!Number.isFinite(date.getTime())) invalid('closed_at');
	const raw = text(row, 'amount_raw');
	if (
		!/^(?:0|-?[1-9][0-9]{0,38})$/.test(raw) ||
		BigInt(raw) < -(1n << 127n) ||
		BigInt(raw) > (1n << 127n) - 1n
	)
		invalid('amount_raw');
	return {
		id: [position.ledger, position.row, position.batch, position.digest].join(
			':'
		),
		ledgerSequence: position.ledger,
		closedAt: date.toISOString(),
		transactionHash: text(row, 'transaction_hash'),
		transactionId: integerText(row, 'transaction_id'),
		operationId:
			row.operation_id === null ? null : integerText(row, 'operation_id'),
		from: nullableText(row, 'from'),
		to: nullableText(row, 'to'),
		toMuxed: nullableText(row, 'to_muxed'),
		asset: {
			id: text(row, 'asset'),
			type,
			code: nullableText(row, 'asset_code'),
			issuer: nullableText(row, 'asset_issuer')
		},
		contractId: text(row, 'contract_id'),
		eventTopic: text(row, 'event_topic'),
		amountRaw: raw,
		amountScale: ['native', 'credit_alphanum4', 'credit_alphanum12'].includes(
			type
		)
			? 7
			: null
	};
}

export function transferPosition(
	row: Readonly<Record<string, unknown>>
): HubbleTransferPosition {
	const ledger = row.ledger_sequence;
	if (typeof ledger !== 'number' || !Number.isSafeInteger(ledger) || ledger < 1)
		invalid('ledger_sequence');
	return {
		ledger,
		row: integerText(row, 'cursor_row'),
		batch: text(row, 'cursor_batch'),
		digest: text(row, 'cursor_digest')
	};
}
function text(row: Readonly<Record<string, unknown>>, field: string): string {
	if (typeof row[field] !== 'string') invalid(field);
	return row[field];
}
function integerText(
	row: Readonly<Record<string, unknown>>,
	field: string
): string {
	const value = text(row, field);
	if (!/^[0-9]+$/.test(value)) invalid(field);
	return value;
}
function nullableText(
	row: Readonly<Record<string, unknown>>,
	field: string
): string | null {
	return row[field] === null ? null : text(row, field);
}
function invalid(field: string): never {
	throw new HubbleWarehouseUnavailableError(
		'Invalid transfer warehouse field: ' + field
	);
}
