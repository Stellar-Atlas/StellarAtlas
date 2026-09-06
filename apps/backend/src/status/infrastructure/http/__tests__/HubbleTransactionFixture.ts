import {
	Account,
	Asset,
	Keypair,
	Memo,
	Networks,
	Operation,
	TransactionBuilder
} from '@stellar/stellar-sdk';
import type {
	HubbleSemanticQueryExecutor,
	HubblePreparedParameter
} from '../HubbleSemanticWarehouse.js';
export const transactionLedger = 26000000;
export const transactionId = '111669149696004096';
export const transactionBatch = '00000000-0000-0000-0000-000000000001';
export const transactionDigest = 'a'.repeat(64);
export const exactOperationAmount = '900719925.4740993';
const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const destination = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8)).publicKey();
const envelope = new TransactionBuilder(
	new Account(source, '9007199254740992'),
	{ fee: '100', networkPassphrase: Networks.PUBLIC }
)
	.addOperation(
		Operation.payment({
			destination,
			asset: Asset.native(),
			amount: exactOperationAmount
		})
	)
	.addOperation(
		Operation.createAccount({ destination, startingBalance: '1.0000001' })
	)
	.addMemo(Memo.text('typed fixture'))
	.setTimeout(0)
	.build();
export const transactionHash = envelope.hash().toString('hex');
const common = {
	ledger_sequence: transactionLedger,
	closed_at: '2026-09-01 00:00:00.000',
	_ledger_sequence: transactionLedger,
	_row_number: '1',
	_batch_id: transactionBatch,
	_source_sha256: transactionDigest,
	_ingested_at: '2026-09-01 00:00:00.000'
};
export const transactionFixture = {
	...common,
	id: transactionId,
	transaction_hash: transactionHash,
	account: source,
	account_muxed: '',
	account_sequence: '9007199254740993',
	successful: true,
	operation_count: 2,
	memo_type: 'text',
	memo: 'typed fixture',
	fee_charged: '200',
	max_fee: 200,
	fee_account: '',
	transaction_result_code: 'tx_success',
	tx_envelope: envelope.toXDR()
};
export const operationFixtures = [1, 2].map((n) => ({
	...common,
	_row_number: String(n),
	id: (BigInt(transactionId) + BigInt(n)).toString(),
	transaction_id: transactionId,
	type: n === 1 ? 1 : 0,
	type_string: n === 1 ? 'payment' : 'create_account',
	source_account: source,
	source_account_muxed: '',
	operation_result_code: 'op_inner',
	operation_trace_code: 'success',
	details: JSON.stringify({ amount: 900719925.4740993 })
}));
export const effectFixtures = [0, 1, 2].map((n) => ({
	...common,
	_row_number: String(n + 1),
	id: transactionId + '-' + n,
	operation_id: operationFixtures[0]!.id,
	index: n,
	type: n === 0 ? 3 : 2,
	type_string: n === 0 ? 'account_debited' : 'account_credited',
	address: destination,
	address_muxed: null,
	details: JSON.stringify({
		amount: exactOperationAmount,
		asset_type: 'native'
	})
}));
export const eventFixtures = [0, 1].map((n) => ({
	...common,
	_row_number: String(n + 1),
	transaction_id: transactionId,
	transaction_hash: transactionHash,
	operation_id: n === 0 ? null : operationFixtures[0]!.id,
	type: 1,
	type_string: 'contract',
	contract_id: Asset.native().contractId(Networks.PUBLIC),
	successful: true,
	in_successful_contract_call: true,
	topics_decoded: [{ symbol: n === 0 ? 'fee' : 'transfer' }],
	data_decoded: '{"i128":"9007199254740993"}',
	contract_event_xdr: 'fixture-xdr'
}));
export function queryFixture() {
	const calls: {
		sql: string;
		parameters: readonly HubblePreparedParameter[];
	}[] = [];
	const executor: HubbleSemanticQueryExecutor = {
		database: 'fixture',
		maximumRows: 200,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			calls.push({ sql, parameters });
			if (sql.includes("SELECT 'transaction' AS kind"))
				return {
					data: [
						{
							kind: 'transaction',
							transaction_id: transactionId,
							ledger_sequence: transactionLedger,
							operation_count: 2,
							operations: []
						},
						{
							kind: 'operations',
							transaction_id: transactionId,
							ledger_sequence: transactionLedger,
							operation_count: null,
							operations: operationFixtures.map((o) => [o.id, o.type])
						}
					] as unknown as T[]
				};
			if (sql.includes('.history_transactions'))
				return { data: [transactionFixture] as unknown as T[] };
			const relation = sql.includes('.history_operations')
				? 'operations'
				: sql.includes('.history_effects')
					? 'effects'
					: 'events';
			const originals =
				relation === 'operations'
					? operationFixtures
					: relation === 'effects'
						? effectFixtures
						: eventFixtures;
			let rows: Record<string, unknown>[] = originals.map((r) => {
				const row: Record<string, unknown> = r;
				return {
					...row,
					cursor_key:
						relation === 'operations'
							? row.id
							: relation === 'effects'
								? row.operation_id
								: row.transaction_id,
					cursor_index: relation === 'effects' ? row.index : 0,
					cursor_row: row._row_number,
					cursor_batch: row._batch_id,
					cursor_digest: row._source_sha256
				};
			});
			const param = (name: string) =>
				parameters.find((p) => p.name === name)?.value;
			if (param('after_key'))
				rows = rows.filter(
					(r) =>
						BigInt(String(r.cursor_key)) > BigInt(param('after_key')!) ||
						(String(r.cursor_key) === param('after_key') &&
							(Number(r.cursor_index) > Number(param('after_index')) ||
								(Number(r.cursor_index) === Number(param('after_index')) &&
									BigInt(String(r.cursor_row)) > BigInt(param('after_row')!))))
				);
			return {
				data: rows.slice(0, Number(param('row_limit'))) as unknown as T[]
			};
		}
	};
	return { executor, calls };
}
