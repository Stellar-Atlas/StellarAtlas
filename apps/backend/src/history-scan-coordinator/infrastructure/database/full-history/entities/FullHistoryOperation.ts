import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
	FullHistoryOperationFactScope,
	FullHistoryOperationSourceOrigin,
	FullHistoryOperationType
} from '../../../../domain/full-history/FullHistoryCanonicalOperation.js';
import {
	fullHistoryHashTransformer,
	fullHistoryLedgerTransformer,
	FullHistoryHash,
	type FullHistoryLedgerSequence
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_operation' })
@Index('idx_full_history_operation_type_ledger', [
	'networkPassphraseHash',
	'operationType',
	'ledgerSequence',
	'transactionIndex',
	'operationIndex'
])
@Index('idx_full_history_operation_source_ledger', [
	'networkPassphraseHash',
	'sourceAccount',
	'ledgerSequence',
	'transactionIndex',
	'operationIndex'
])
@Index('idx_full_history_operation_ledger', [
	'networkPassphraseHash',
	'ledgerSequence',
	'transactionIndex',
	'operationIndex'
])
export class FullHistoryOperation {
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

	@PrimaryColumn('integer', { name: 'operation_index' })
	readonly operationIndex!: number;

	@Column('uuid', { name: 'batch_id' })
	readonly batchId!: string;

	@Column('bigint', {
		name: 'ledger_sequence',
		transformer: fullHistoryLedgerTransformer
	})
	readonly ledgerSequence!: FullHistoryLedgerSequence;

	@Column('integer', { name: 'transaction_index' })
	readonly transactionIndex!: number;

	@Column('text', { name: 'operation_type' })
	readonly operationType!: FullHistoryOperationType;

	@Column('text', { name: 'source_account' })
	readonly sourceAccount!: string;

	@Column('text', { name: 'source_account_origin' })
	readonly sourceAccountOrigin!: FullHistoryOperationSourceOrigin;

	@Column('text', { name: 'fact_scope' })
	readonly factScope!: FullHistoryOperationFactScope;
}
