import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
	fullHistoryHashTransformer,
	fullHistoryLedgerTransformer,
	FullHistoryHash,
	type FullHistoryLedgerSequence
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_ledger' })
@Index('uq_full_history_ledger_hash', ['networkPassphraseHash', 'ledgerHash'], {
	unique: true
})
@Index('idx_full_history_ledger_closed_at', [
	'networkPassphraseHash',
	'closedAt'
])
@Index(
	'uq_full_history_ledger_batch_identity',
	['batchId', 'networkPassphraseHash', 'ledgerSequence'],
	{ unique: true }
)
export class FullHistoryLedger {
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

	@Column('uuid', { name: 'batch_id' })
	readonly batchId!: string;

	@Column('bytea', {
		name: 'ledger_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly ledgerHash!: FullHistoryHash;

	@Column('bytea', {
		name: 'previous_ledger_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly previousLedgerHash!: FullHistoryHash;

	@Column('bytea', {
		name: 'transaction_set_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionSetHash!: FullHistoryHash;

	@Column('bytea', {
		name: 'transaction_result_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionResultHash!: FullHistoryHash;

	@Column('bytea', {
		name: 'bucket_list_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly bucketListHash!: FullHistoryHash;

	@Column('integer', { name: 'protocol_version' })
	readonly protocolVersion!: number;

	@Column('timestamptz', { name: 'closed_at' })
	readonly closedAt!: Date;

	@Column('integer', { name: 'transaction_count' })
	readonly transactionCount!: number;
}
