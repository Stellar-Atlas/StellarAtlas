import { Asset, StrKey } from '@stellar/stellar-sdk';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import type { HubbleTransfer } from './HubbleTransferContracts.js';
import { exactDecimalAmount, verifiedTransactionEnvelope } from './HubbleTransactionEnvelope.js';
import { quoteHubbleIdentifier, type HubblePreparedParameter, type HubbleSemanticQueryExecutor } from './HubbleSemanticWarehouse.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';

type Row = Readonly<Record<string, unknown>>;
const key = (ledger: number, id: string): string => [ledger, id].join(':');
const classic = (value: string | null): value is string => value !== null && StrKey.isValidEd25519PublicKey(value);

/** One exact-tuple read for the requested page only; no joins, new index, or full-history scan.
 * Match successful classic payment operations, not diagnostic/custom token-event claims.
 */
export async function verifyTransferPayments(
	executor: HubbleSemanticQueryExecutor,
	transfers: readonly HubbleTransfer[]
): Promise<readonly HubbleTransfer[]> {
	if (transfers.length > 20) throw new HubbleWarehouseUnavailableError('Payment evidence page exceeds 20 rows');
	const candidates = transfers.filter(row => row.eventTopic === 'transfer' && row.amountScale === 7 &&
		classic(row.from) && classic(row.to) && row.toMuxed === null && row.from !== row.to &&
		/^[a-f0-9]{64}$/.test(row.transactionHash) && /^[1-9][0-9]{0,18}$/.test(row.transactionId) &&
		/^[1-9][0-9]{0,18}$/.test(row.operationId ?? '') && /^[1-9][0-9]{0,18}$/.test(row.amountRaw) &&
		(BigInt(row.transactionId) >> 32n) === BigInt(row.ledgerSequence) && BigInt(row.transactionId) % 4096n === 0n &&
		(BigInt(row.transactionId) & 0xffffffffn) >= 4096n);
	const unverified = (): readonly HubbleTransfer[] => transfers.map(row => ({ ...row, paymentEvidence: null }));
	const identities = new Map(candidates.map(row => [key(row.ledgerSequence, row.transactionId), row]));
	if (!identities.size) return unverified();
	const parameters: HubblePreparedParameter[] = [];
	const tuples = [...identities.values()].map((row, i) => {
		parameters.push({ name: 'payment_ledger_' + i, type: 'UInt32', value: String(row.ledgerSequence) },
			{ name: 'payment_id_' + i, type: 'Int64', value: row.transactionId });
		return `({payment_ledger_${i}:UInt32}, {payment_id_${i}:Int64})`;
	});
	const ledgers = [...new Set(candidates.map(row => row.ledgerSequence))];
	const partitions = ledgers.map((ledger, i) => {
		parameters.push({ name: 'payment_partition_' + i, type: 'UInt32', value: String(ledger) });
		return '{payment_partition_' + i + ':UInt32}';
	}).join(', ');
	parameters.push({ name: 'payment_min', type: 'UInt32', value: String(Math.min(...ledgers)) },
		{ name: 'payment_max', type: 'UInt32', value: String(Math.max(...ledgers)) },
		{ name: 'payment_limit', type: 'UInt32', value: String(identities.size + 1) });
	let result: { readonly data?: readonly Row[] };
	try { result = await executor.execute<Row>([
		'SELECT ledger_sequence, transaction_hash, toString(id) AS transaction_id, successful, account, account_muxed,',
		' operation_count, toUInt32(least(length(tx_envelope), 262145)) AS envelope_length, substring(tx_envelope, 1, 262144) AS tx_envelope',
		'FROM ' + quoteHubbleIdentifier(executor.database) + '.history_transactions',
		'WHERE _ledger_sequence >= {payment_min:UInt32} AND _ledger_sequence <= {payment_max:UInt32}',
		' AND ledger_sequence >= {payment_min:UInt32} AND ledger_sequence <= {payment_max:UInt32}',
		' AND _ledger_sequence IN (' + partitions + ') AND ledger_sequence IN (' + partitions + ')',
		' AND tuple(ledger_sequence, id) IN (' + tuples.join(', ') + ')',
		' AND ' + completedHubbleBatchPredicate(executor.database),
		'LIMIT {payment_limit:UInt32} FORMAT JSON'
	].join('\n'), parameters); }
	catch { return unverified(); } // Preserve the activity page; no retry or positive safety inference.
	if (!Array.isArray(result.data) || result.data.length > identities.size)
		return unverified();
	const found = new Map<string, Row | null>();
	for (const row of result.data) {
		if (typeof row.ledger_sequence !== 'number' || typeof row.transaction_hash !== 'string' || typeof row.transaction_id !== 'string')
			return unverified();
		const identity = key(row.ledger_sequence, row.transaction_id);
		if (!identities.has(identity)) return unverified();
		found.set(identity, found.has(identity) ? null : row);
	}
	return transfers.map(transfer => ({ ...transfer, paymentEvidence:
		candidates.includes(transfer) && verifiedPayment(transfer, found.get(key(transfer.ledgerSequence, transfer.transactionId)))
			? 'mainnet-successful-payment' : null }));
}

function verifiedPayment(transfer: HubbleTransfer, row: Row | null | undefined): boolean {
	if (!row || row.transaction_hash !== transfer.transactionHash || (row.successful !== true && row.successful !== 1) || typeof row.tx_envelope !== 'string' ||
		typeof row.envelope_length !== 'number' || row.envelope_length < 1 || row.envelope_length > 262144 || row.envelope_length !== row.tx_envelope.length ||
		!classic(typeof row.account === 'string' ? row.account : null) ||
		(row.account_muxed !== null && row.account_muxed !== '') ||
		typeof row.operation_count !== 'number' || !Number.isInteger(row.operation_count) || row.operation_count < 1 || row.operation_count > 100)
		return false;
	const envelope = verifiedTransactionEnvelope(row.tx_envelope, transfer.transactionHash);
	const operations = envelope?.operations;
	const index = Number(BigInt(transfer.operationId!) - BigInt(transfer.transactionId) - 1n);
	if (!operations || operations.length !== row.operation_count || index < 0 || index >= operations.length) return false;
	const operation = operations[index];
	if (!operation || typeof operation !== 'object') return false;
	const payment = operation as Readonly<Record<string, unknown>>;
	if (payment.type !== 'payment' || (payment.source ?? envelope?.source) !== transfer.from || payment.destination !== transfer.to ||
		typeof payment.amount !== 'string' || !(payment.asset instanceof Asset)) return false;
	const asset = payment.asset;
	const assetId = asset.isNative() ? 'native' : asset.getCode() + ':' + asset.getIssuer();
	return transfer.asset.id === assetId && transfer.asset.type === asset.getAssetType() &&
		exactDecimalAmount('amount', payment.amount, 'envelope', 7)?.raw === transfer.amountRaw;
}
