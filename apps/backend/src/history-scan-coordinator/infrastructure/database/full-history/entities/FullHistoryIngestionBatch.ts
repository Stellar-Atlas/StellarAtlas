import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn
} from 'typeorm';
import {
	fullHistoryHashTransformer,
	fullHistoryLedgerTransformer,
	FullHistoryHash,
	type FullHistoryLedgerSequence
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';

@Entity({ name: 'full_history_ingestion_batch' })
@Index(
	'uq_full_history_batch_network_checkpoint',
	['networkPassphraseHash', 'checkpointLedger'],
	{ unique: true }
)
@Index('uq_full_history_batch_proof', ['checkpointProofId'], { unique: true })
@Index(
	'uq_full_history_batch_network_identity',
	['id', 'networkPassphraseHash'],
	{
		unique: true
	}
)
export class FullHistoryIngestionBatch {
	@PrimaryColumn('uuid')
	readonly id!: string;

	@Column('bytea', {
		name: 'network_passphrase_hash',
		transformer: fullHistoryHashTransformer
	})
	readonly networkPassphraseHash!: FullHistoryHash;

	@Column('integer', { name: 'checkpoint_proof_id' })
	readonly checkpointProofId!: number;

	@Column('smallint', { name: 'proof_version' })
	readonly proofVersion!: number;

	@Column('timestamptz', { name: 'proof_evaluated_at' })
	readonly proofEvaluatedAt!: Date;

	@Column('text', { name: 'archive_url_identity' })
	readonly archiveUrlIdentity!: string;

	@Column('bigint', {
		name: 'checkpoint_ledger',
		transformer: fullHistoryLedgerTransformer
	})
	readonly checkpointLedger!: FullHistoryLedgerSequence;

	@Column('bigint', {
		name: 'first_ledger',
		transformer: fullHistoryLedgerTransformer
	})
	readonly firstLedger!: FullHistoryLedgerSequence;

	@Column('bigint', {
		name: 'last_ledger',
		transformer: fullHistoryLedgerTransformer
	})
	readonly lastLedger!: FullHistoryLedgerSequence;

	@Column('uuid', { name: 'checkpoint_state_object_remote_id' })
	readonly checkpointStateObjectRemoteId!: string;

	@Column('bytea', {
		name: 'checkpoint_state_content_digest',
		transformer: fullHistoryHashTransformer
	})
	readonly checkpointStateContentDigest!: FullHistoryHash;

	@Column('uuid', { name: 'ledger_object_remote_id' })
	readonly ledgerObjectRemoteId!: string;

	@Column('bytea', {
		name: 'ledger_content_digest',
		transformer: fullHistoryHashTransformer
	})
	readonly ledgerContentDigest!: FullHistoryHash;

	@Column('uuid', { name: 'transactions_object_remote_id' })
	readonly transactionsObjectRemoteId!: string;

	@Column('bytea', {
		name: 'transactions_content_digest',
		transformer: fullHistoryHashTransformer
	})
	readonly transactionsContentDigest!: FullHistoryHash;

	@Column('uuid', { name: 'results_object_remote_id' })
	readonly resultsObjectRemoteId!: string;

	@Column('bytea', {
		name: 'results_content_digest',
		transformer: fullHistoryHashTransformer
	})
	readonly resultsContentDigest!: FullHistoryHash;

	@Column('varchar', { length: 128, name: 'decoder_version' })
	readonly decoderVersion!: string;

	@Column('integer', { name: 'ledger_count' })
	readonly ledgerCount!: number;

	@Column('integer', { name: 'transaction_count' })
	readonly transactionCount!: number;

	@Column('integer', { name: 'result_count' })
	readonly resultCount!: number;

	@CreateDateColumn({ name: 'ingested_at', type: 'timestamptz' })
	readonly ingestedAt!: Date;
}
