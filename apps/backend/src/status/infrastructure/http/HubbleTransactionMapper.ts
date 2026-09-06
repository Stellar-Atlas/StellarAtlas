import type { HubbleEventClassification } from './HubbleEventClassification.js';
import type {
	HubbleTransactionRecord,
	HubbleTransactionOperation,
	HubbleTransactionEffect,
	HubbleTransactionEvent,
	HubbleExactAmount
} from './HubbleTransactionContracts.js';
import {
	envelopeAmounts,
	exactDecimalAmount
} from './HubbleTransactionEnvelope.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

export function transactionString(value: unknown, field: string): string {
	if (typeof value !== 'string')
		throw new HubbleWarehouseUnavailableError('Invalid transaction ' + field);
	return value;
}
export function transactionInteger(value: unknown, field: string): string {
	const text =
		typeof value === 'number' && Number.isSafeInteger(value)
			? String(value)
			: value;
	if (typeof text !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(text))
		throw new HubbleWarehouseUnavailableError(
			'Invalid exact transaction ' + field
		);
	return text;
}
export function transactionNumber(value: unknown, field: string): number {
	const number = Number(transactionInteger(value, field));
	if (!Number.isSafeInteger(number) || number < 0 || number > 2147483647)
		throw new HubbleWarehouseUnavailableError('Invalid transaction ' + field);
	return number;
}
function nullable(value: unknown): string | null {
	return value === null || value === undefined || value === ''
		? null
		: transactionString(value, 'nullable string');
}
function boolean(value: unknown): boolean {
	if (value !== true && value !== false && value !== 0 && value !== 1)
		throw new HubbleWarehouseUnavailableError('Invalid transaction boolean');
	return value === true || value === 1;
}
function closedAt(value: unknown): string {
	const text = transactionString(value, 'closed_at');
	const utc = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(text)
		? text
		: text.replace(' ', 'T') + 'Z';
	const time = Date.parse(utc);
	if (!Number.isFinite(time))
		throw new HubbleWarehouseUnavailableError('Invalid transaction close time');
	return new Date(time).toISOString();
}
function jsonText(value: unknown): string {
	if (typeof value === 'string') return value;
	return JSON.stringify(value ?? null);
}
export function mapTransaction(
	row: Record<string, unknown>
): HubbleTransactionRecord {
	return {
		id: transactionInteger(row.id, 'id'),
		hash: transactionString(row.transaction_hash, 'hash'),
		ledgerSequence: transactionNumber(row.ledger_sequence, 'ledger'),
		closedAt: closedAt(row.closed_at),
		sourceAccount: transactionString(row.account, 'account'),
		sourceAccountMuxed: nullable(row.account_muxed),
		sequence: transactionInteger(row.account_sequence, 'sequence'),
		successful: boolean(row.successful),
		operationCount: transactionNumber(row.operation_count, 'operation count'),
		memoType: transactionString(row.memo_type, 'memo type'),
		memo: transactionString(row.memo, 'memo'),
		feeChargedRaw: transactionInteger(row.fee_charged, 'fee charged'),
		maxFeeRaw: transactionInteger(row.max_fee, 'maximum fee'),
		feeAccount: nullable(row.fee_account),
		resultCode: transactionString(row.transaction_result_code, 'result code')
	};
}
export function mapTransactionOperation(
	row: Record<string, unknown>,
	transaction: HubbleTransactionRecord,
	envelope: readonly unknown[] | null
): HubbleTransactionOperation {
	const id = transactionInteger(row.id, 'operation id');
	const index = Number(BigInt(id) - BigInt(transaction.id) - 1n);
	if (
		!Number.isSafeInteger(index) ||
		index < 0 ||
		index >= transaction.operationCount
	)
		throw new HubbleWarehouseUnavailableError(
			'Operation identity is outside its transaction'
		);
	const decoded =
		envelope?.length === transaction.operationCount
			? envelope[index]
			: undefined;
	return {
		id,
		transactionId: transactionInteger(row.transaction_id, 'transaction id'),
		index,
		ledgerSequence: transactionNumber(row.ledger_sequence, 'ledger'),
		closedAt: closedAt(row.closed_at),
		type: transactionString(row.type_string, 'operation type'),
		typeCode: transactionNumber(row.type, 'operation type code'),
		sourceAccount: transactionString(row.source_account, 'operation source'),
		sourceAccountMuxed: nullable(row.source_account_muxed),
		resultCode: transactionString(
			row.operation_result_code,
			'operation result'
		),
		traceCode: transactionString(row.operation_trace_code, 'operation trace'),
		envelopeDecoded: decoded !== undefined,
		amounts: envelopeAmounts(decoded),
		detailsJson: jsonText(row.details)
	};
}
const effectAmountFields = new Set([
	'amount',
	'starting_balance',
	'limit',
	'bought_amount',
	'sold_amount',
	'total_shares',
	'shares_received',
	'shares_redeemed',
	'shares_revoked'
]);
function effectAmounts(value: unknown): readonly HubbleExactAmount[] {
	let details: unknown = value;
	if (typeof value === 'string') {
		try {
			details = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (details === null || typeof details !== 'object' || Array.isArray(details))
		return [];
	return Object.entries(details).flatMap(([field, value]) => {
		if (!effectAmountFields.has(field) || typeof value !== 'string') return [];
		const amount = exactDecimalAmount(field, value, 'effect', 7);
		return amount === null ? [] : [amount];
	});
}
export function mapTransactionEffect(
	row: Record<string, unknown>
): HubbleTransactionEffect {
	return {
		id: transactionString(row.id, 'effect id'),
		operationId: transactionInteger(row.operation_id, 'effect operation'),
		index: transactionNumber(row.index, 'effect index'),
		ledgerSequence: transactionNumber(row.ledger_sequence, 'ledger'),
		closedAt: closedAt(row.closed_at),
		type: transactionString(row.type_string, 'effect type'),
		typeCode: transactionNumber(row.type, 'effect type code'),
		account: transactionString(row.address, 'effect account'),
		accountMuxed: nullable(row.address_muxed),
		amounts: effectAmounts(row.details),
		detailsJson: jsonText(row.details)
	};
}
export function mapTransactionEvent(
	row: Record<string, unknown>
): HubbleTransactionEvent {
	const classification = row.classification as
		HubbleEventClassification | undefined;
	if (!classification)
		throw new HubbleWarehouseUnavailableError('Missing event classification');
	return {
		id: [
			row.ledger_sequence,
			row.cursor_row,
			row.cursor_batch,
			row.cursor_digest
		].join(':'),
		transactionId: transactionInteger(row.transaction_id, 'event transaction'),
		transactionHash: transactionString(
			row.transaction_hash,
			'event transaction hash'
		),
		operationId:
			row.operation_id === null
				? null
				: transactionInteger(row.operation_id, 'event operation'),
		ledgerSequence: transactionNumber(row.ledger_sequence, 'ledger'),
		closedAt: closedAt(row.closed_at),
		contractId: transactionString(row.contract_id, 'event contract'),
		type: transactionString(row.type_string, 'event type'),
		typeCode: transactionNumber(row.type, 'event type code'),
		successful: boolean(row.successful),
		inSuccessfulContractCall: boolean(row.in_successful_contract_call),
		topicsJson: jsonText(row.topics_decoded),
		dataJson: jsonText(row.data_decoded),
		eventXdr: transactionString(row.contract_event_xdr, 'event XDR'),
		classification
	};
}
