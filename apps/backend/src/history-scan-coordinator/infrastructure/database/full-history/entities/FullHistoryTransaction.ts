import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { FullHistoryEnvelopeType } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	fullHistoryHashTransformer,
	fullHistoryLedgerTransformer,
	fullHistoryUint64Transformer,
	FullHistoryHash,
	type FullHistoryLedgerSequence,
	type FullHistoryUint64String
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_transaction' })
@Index(
	'uq_full_history_transaction_position',
	['networkPassphraseHash', 'ledgerSequence', 'transactionIndex'],
	{ unique: true }
)
@Index(
	'uq_full_history_transaction_batch_identity',
	['batchId', 'networkPassphraseHash', 'transactionHash'],
	{ unique: true }
)
@Index(
	'uq_full_history_transaction_result_identity',
	[
		'batchId',
		'networkPassphraseHash',
		'ledgerSequence',
		'transactionIndex',
		'transactionHash'
	],
	{ unique: true }
)
export class FullHistoryTransaction {
	@PrimaryColumn('bytea', {
		name: 'network_passphrase_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly networkPassphraseHash!: FullHistoryHash;

	@PrimaryColumn('bytea', {
		name: 'transaction_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionHash!: FullHistoryHash;

	@Column('uuid', { name: 'batch_id' })
	readonly batchId!: string;

	@Column('bigint', {
		name: 'ledger_sequence',
		transformer: fullHistoryLedgerTransformer
	})
	readonly ledgerSequence!: FullHistoryLedgerSequence;

	@Column('integer', { name: 'transaction_index' })
	readonly transactionIndex!: number;

	@Column('text', { name: 'envelope_type' })
	readonly envelopeType!: FullHistoryEnvelopeType;

	@Column('text', { name: 'source_account' })
	readonly sourceAccount!: string;

	@Column('bigint', {
		name: 'source_account_sequence',
		transformer: fullHistoryUint64Transformer
	})
	readonly sourceAccountSequence!: FullHistoryUint64String;

	@Column('bigint', {
		name: 'fee_bid',
		transformer: fullHistoryUint64Transformer
	})
	readonly feeBid!: FullHistoryUint64String;

	@Column('integer', { name: 'operation_count' })
	readonly operationCount!: number;
}
