import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { verifyTransferPayments } from '../HubbleTransferPaymentEvidence.js';
import { queryHubbleTransferActivity } from '../HubbleTransferQuery.js';
import type { HubbleTransfer } from '../HubbleTransferContracts.js';
import type { HubblePreparedParameter, HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';
import { transferRow } from './HubbleTransferFixture.js';
const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const recipient = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
function payment(network = Networks.PUBLIC) {
	const tx = new TransactionBuilder(new Account(source.publicKey(), '0'), { fee: '100', networkPassphrase: network })
		.addOperation(Operation.payment({ destination: recipient.publicKey(), asset: Asset.native(), amount: '1.0000001' }))
		.setTimeout(0).build();
	const transactionId = ((63n << 32n) + 4096n).toString();
	const transfer: HubbleTransfer = { id: 'first', ledgerSequence: 63, closedAt: '2026-11-11T00:00:00Z',
		transactionHash: Buffer.from(tx.hash()).toString('hex'), transactionId, operationId: (BigInt(transactionId) + 1n).toString(),
		from: source.publicKey(), to: recipient.publicKey(), toMuxed: null, asset: { id: 'native', type: 'native', code: null, issuer: null },
		contractId: '', eventTopic: 'transfer', amountRaw: '10000001', amountScale: 7 };
	return { transfer, evidence: { ledger_sequence: 63, transaction_id: transactionId, transaction_hash: transfer.transactionHash,
		successful: true, account: source.publicKey(), account_muxed: null, operation_count: 1, envelope_length: tx.toXDR().length, tx_envelope: tx.toXDR() } };
}
function executor(rows: readonly Record<string, unknown>[], fail = false) {
	const requests: { sql: string; parameters: readonly HubblePreparedParameter[] }[] = [];
	const executor: HubbleSemanticQueryExecutor = { database: 'stellar_hubble', maximumRows: 200,
		async execute<T>(sql: string, parameters: readonly HubblePreparedParameter[]) {
			requests.push({ sql, parameters }); if (fail) throw new Error('Fixture unavailable');
			return { data: rows as readonly T[] };
		} };
	return { executor, requests };
}
it('uses one exact natural-key/partition batch and verifies successful mainnet envelope payment identity/amount', async () => {
	const { transfer, evidence } = payment(), fixture = executor([evidence]);
	expect((await verifyTransferPayments(fixture.executor, [transfer]))[0]?.paymentEvidence).toBe('mainnet-successful-payment');
	expect(fixture.requests).toHaveLength(1);
	const sql = fixture.requests[0]!.sql;
	for (const fragment of ['_ledger_sequence IN (', 'ledger_sequence IN (', 'tuple(ledger_sequence, id) IN (', '_ingestion_batches', 'LIMIT {payment_limit:UInt32}', 'substring(tx_envelope, 1, 262144)']) expect(sql).toContain(fragment);
	expect(sql).not.toContain('transaction_hash =');
	expect(sql).not.toContain('AND length(tx_envelope)');
});
it('keeps unavailable, missing, duplicate and contradictory evidence unknown without losing the activity page or retrying', async () => {
	const { transfer, evidence } = payment();
	for (const rows of [[], [evidence, evidence], [evidence, { ...evidence, tx_envelope: null, envelope_length: null }],
		[{ ...evidence, envelope_length: 262145 }], [{ ...evidence, successful: false }], [{ ...evidence, transaction_hash: 'f'.repeat(64) }]]) {
		const fixture = executor(rows);
		expect((await verifyTransferPayments(fixture.executor, [transfer]))[0]).toMatchObject({ id: transfer.id, paymentEvidence: null });
		expect(fixture.requests).toHaveLength(1);
	}
	const fixture = executor([], true);
	expect((await verifyTransferPayments(fixture.executor, [transfer]))[0]?.paymentEvidence).toBeNull();
	expect(fixture.requests).toHaveLength(1);
});
it('rejects wrong-network hashes, altered transfer claims, self transfers, muxed targets and unsupported operations', async () => {
	const { transfer, evidence } = payment();
	for (const changed of [{ amountRaw: '10000002' }, { from: recipient.publicKey() }, { to: source.publicKey() },
		{ toMuxed: 'M' + 'A'.repeat(68) }, { eventTopic: 'fee' }, { operationId: transfer.transactionId },
		{ asset: { ...transfer.asset, id: 'USD:' + source.publicKey() } }])
		expect((await verifyTransferPayments(executor([evidence]).executor, [{ ...transfer, ...changed }]))[0]?.paymentEvidence).toBeNull();
	const testnet = payment(Networks.TESTNET);
	expect((await verifyTransferPayments(executor([testnet.evidence]).executor, [testnet.transfer]))[0]?.paymentEvidence).toBeNull();
});
it('leaves ordinary transfer queries unchanged and applies enrichment only after slicing the cursor sentinel', async () => {
	const { transfer, evidence } = payment();
	const raw = transferRow({ transaction_id: transfer.transactionId, operation_id: transfer.operationId,
		transaction_hash: transfer.transactionHash, from: transfer.from, to: transfer.to, amount_raw: transfer.amountRaw });
	const requests: string[] = [];
	const fixture: HubbleSemanticQueryExecutor = { database: 'stellar_hubble', maximumRows: 200,
		async execute<T>(sql: string) { requests.push(sql); return { data: (sql.includes('.token_transfers') ? [raw, { ...raw, cursor_row: '9' }] : [evidence]) as readonly T[] }; } };
	await queryHubbleTransferActivity(fixture, { limit: 1 }, 70);
	expect(requests).toHaveLength(1); requests.length = 0;
	const page = await queryHubbleTransferActivity(fixture, { account: source.publicKey(), evidence: 'payment', limit: 1 }, 70);
	expect(requests).toHaveLength(2); expect(page.transfers).toHaveLength(1);
	expect(page.transfers[0]?.paymentEvidence).toBe('mainnet-successful-payment'); expect(page.nextCursor).not.toBeNull();
});
