import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
	fullHistoryHashTransformer,
	fullHistoryLedgerTransformer,
	fullHistoryUint64Transformer,
	FullHistoryHash,
	type FullHistoryLedgerSequence,
	type FullHistoryUint64String
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_transaction_result' })
@Index(
	'uq_full_history_result_hash',
	['networkPassphraseHash', 'transactionHash'],
	{ unique: true }
)
export class FullHistoryTransactionResult {
	@PrimaryColumn('bytea', {
		name: 'network_passphrase_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly networkPassphraseHash!: FullHistoryHash;

	@PrimaryColumn('bigint', {
		name: 'ledger_sequence',
		transformer: fullHistoryLedgerTransformer
	})
	readonly ledgerSequence!: FullHistoryLedgerSequence;

	@PrimaryColumn('integer', { name: 'transaction_index' })
	readonly transactionIndex!: number;

	@PrimaryColumn('bytea', {
		name: 'transaction_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionHash!: FullHistoryHash;

	@Column('uuid', { name: 'batch_id' })
	readonly batchId!: string;

	@Column('bigint', {
		name: 'fee_charged',
		transformer: fullHistoryUint64Transformer
	})
	readonly feeCharged!: FullHistoryUint64String;

	@Column('boolean')
	readonly successful!: boolean;

	@Column('integer', { name: 'result_code' })
	readonly resultCode!: number;

	@Column('integer', { name: 'operation_result_count' })
	readonly operationResultCount!: number;
}
