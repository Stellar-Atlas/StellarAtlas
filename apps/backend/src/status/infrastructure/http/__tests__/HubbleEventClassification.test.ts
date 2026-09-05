import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import {
	Asset,
	Networks,
	Transaction,
	TransactionBuilder,
	xdr
} from '@stellar/stellar-sdk';
import {
	classifyHubbleEvent,
	hubbleEventIdentifier,
	type HubbleEventProvenance
} from '../HubbleEventClassification.js';

const event = {
	transaction_id: '100',
	ledger_sequence: 123,
	operation_id: null,
	type: 1
};
const invocation: HubbleEventProvenance = {
	transactionId: '100',
	ledgerSequence: 123,
	expectedOperationCount: 1,
	operations: [
		{ id: '101', type: xdr.OperationType.invokeHostFunction().value }
	]
};

describe('Hubble event classification', () => {
	it('classifies the actual 2019 fee sample as classic, despite contract type/id and successful-call flag', () => {
		// Read-only live API sample, 2026-09-05: ledger 26,000,000, transaction hash
		// 5601a324dae6b95aeb626e4de68268fbb996a655979228178d291fc4b8c908cd.
		const row = {
			transaction_id: '111669149696004096',
			ledger_sequence: 26_000_000,
			operation_id: null,
			type: 1,
			in_successful_contract_call: true,
			contract_id: 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
			topics_decoded: [{ symbol: 'fee', address: '' }]
		};
		const result = classifyHubbleEvent(row, {
			transactionId: row.transaction_id,
			ledgerSequence: row.ledger_sequence,
			expectedOperationCount: 19,
			operations: Array.from({ length: 19 }, (_, index) => ({
				id: String(BigInt(row.transaction_id) + BigInt(index + 1)),
				type: 1
			}))
		});
		expect(result).toEqual({
			transactionKind: 'classic',
			eventKind: 'fee',
			sorobanExecutionEvidence: false,
			provenance: 'complete'
		});
	});

	it('does not label a Soroban transaction fee as invocation evidence', () => {
		expect(
			classifyHubbleEvent(
				{
					...event,
					contract_id: Asset.native().contractId(Networks.PUBLIC),
					topics_decoded: [{ symbol: 'fee' }]
				},
				invocation
			)
		).toEqual({
			transactionKind: 'soroban',
			eventKind: 'fee',
			sorobanExecutionEvidence: false,
			provenance: 'complete'
		});
	});

	it('does not suppress invocation evidence for a custom contract topic named fee', () => {
		const result = classifyHubbleEvent(
			{
				...event,
				operation_id: '101',
				contract_id: 'custom-contract',
				topics_decoded: [{ symbol: 'fee' }]
			},
			invocation
		);
		expect(result).toEqual({
			transactionKind: 'soroban',
			eventKind: 'contract',
			sorobanExecutionEvidence: true,
			provenance: 'complete'
		});
		expect(
			classifyHubbleEvent(
				{
					...event,
					topics_decoded: [{ symbol: 'fee' }]
				},
				null
			).eventKind
		).toBe('unknown');
	});

	it('does not label footprint restoration as contract invocation', () => {
		expect(
			classifyHubbleEvent(event, {
				...invocation,
				operations: [
					{ id: '101', type: xdr.OperationType.restoreFootprint().value }
				]
			}).sorobanExecutionEvidence
		).toBe(false);
	});

	it('requires complete matching relationships, not a date heuristic or contract ID', () => {
		expect(classifyHubbleEvent(event, null).provenance).toBe('missing');
		expect(
			classifyHubbleEvent(event, { ...invocation, ledgerSequence: 124 })
				.provenance
		).toBe('mismatch');
		expect(
			classifyHubbleEvent(event, { ...invocation, expectedOperationCount: 2 })
				.provenance
		).toBe('incomplete');
		expect(
			classifyHubbleEvent({ ...event, operation_id: '999' }, invocation)
				.provenance
		).toBe('mismatch');
		expect(
			classifyHubbleEvent(event, {
				...invocation,
				operations: [{ id: '101', type: 99 }]
			}).transactionKind
		).toBe('unknown');
	});

	it('preserves 64-bit transaction identities and rejects rounded numbers', () => {
		expect(hubbleEventIdentifier('111669149696004096')).toBe(
			'111669149696004096'
		);
		expect(hubbleEventIdentifier(111669149696004096)).toBeNull();
		expect(hubbleEventIdentifier('9223372036854775808')).toBeNull();
	});

	it('derives genuine invocation evidence from the existing ledger 53,312,000 LCM fixture', () => {
		const compressed = readFileSync(
			new URL(
				'../../../../../../full-history-etl/internal/testdata/FCD285FF--53312000.xdr.zstd',
				import.meta.url
			)
		);
		const batch = xdr.LedgerCloseMetaBatch.fromXDR(
			zstdDecompressSync(compressed, { maxOutputLength: 1 << 20 })
		);
		const meta = batch.ledgerCloseMeta()[0]!.v1();
		const envelopes = meta
			.txSet()
			.v1TxSet()
			.phases()
			.flatMap((phase) =>
				phase
					.v0Components()
					.flatMap((component) => component.txsMaybeDiscountedFee().txes())
			);
		const transaction = envelopes
			.map((envelope) =>
				TransactionBuilder.fromXDR(envelope.toXDR('base64'), Networks.PUBLIC)
			)
			.find(
				(candidate): candidate is Transaction =>
					candidate instanceof Transaction &&
					candidate.operations.some(
						(operation) => operation.type === 'invokeHostFunction'
					)
			);
		expect(transaction?.hash().toString('hex')).toBe(
			'f551d9cfa65681c9376db2fc0efcc8ef9045c306c0b54e779c0a70514dec880f'
		);
		if (transaction === undefined)
			throw new Error('Fixture invocation missing');
		const position = meta
			.txProcessing()
			.findIndex((item) =>
				item.result().transactionHash().equals(transaction.hash())
			);
		const soroban = meta
			.txProcessing()
			[position]!.txApplyProcessing()
			.v3()
			.sorobanMeta();
		if (soroban === null || soroban === undefined)
			throw new Error('Fixture Soroban metadata missing');
		const diagnostic = soroban.diagnosticEvents().find((item) => {
			const topics = item.event().body().v0().topics();
			return (
				topics.length === 2 &&
				topics.every((topic) => topic.switch().name === 'scvSymbol') &&
				topics[0]!.sym().toString() === 'fn_return' &&
				topics[1]!.sym().toString() === 'set_price'
			);
		});
		if (diagnostic === undefined)
			throw new Error('Fixture set_price return missing');
		const transactionId = String(
			(BigInt(batch.startSequence()) << 32n) | (BigInt(position + 1) << 12n)
		);
		const row = {
			transaction_id: transactionId,
			ledger_sequence: batch.startSequence(),
			operation_id: null,
			type: diagnostic.event().type().value,
			topics_decoded: diagnostic
				.event()
				.body()
				.v0()
				.topics()
				.map((topic) => ({ symbol: topic.sym().toString() }))
		};
		expect(
			classifyHubbleEvent(row, {
				transactionId,
				ledgerSequence: batch.startSequence(),
				expectedOperationCount: transaction.operations.length,
				operations: [
					{
						id: String(BigInt(transactionId) + 1n),
						type: xdr.OperationType.invokeHostFunction().value
					}
				]
			})
		).toEqual({
			transactionKind: 'soroban',
			eventKind: 'diagnostic',
			sorobanExecutionEvidence: true,
			provenance: 'complete'
		});
		expect(classifyHubbleEvent(row, null).sorobanExecutionEvidence).toBe(false);
	});
});
