import { CoreEntity } from '@core/domain/CoreEntity.js';
import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	UpdateDateColumn
} from 'typeorm';

export const CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION = 7;

export type HistoryArchiveCheckpointProofStatus =
	'pending' | 'verified' | 'mismatch' | 'not-evaluable';

export type HistoryArchiveCheckpointProofFailureKind =
	| 'object-incomplete'
	| 'object-failed'
	| 'proof-facts-incomplete'
	| 'checkpoint-ledger-mismatch'
	| 'checkpoint-bucket-list-mismatch'
	| 'transaction-hash-mismatch'
	| 'result-hash-mismatch'
	| 'predecessor-missing'
	| 'previous-ledger-hash-mismatch'
	| 'bucket-missing';

@Entity({ name: 'history_archive_checkpoint_proof' })
@Index(
	'uq_history_archive_checkpoint_proof_identity',
	['archiveUrlIdentity', 'checkpointLedger'],
	{ unique: true }
)
@Index('idx_history_archive_checkpoint_proof_status', ['status', 'evaluatedAt'])
@Index('idx_history_archive_checkpoint_proof_archive', [
	'archiveUrlIdentity',
	'status'
])
export class HistoryArchiveCheckpointProof extends CoreEntity {
	@Column('text')
	public archiveUrl!: string;

	@Column('text')
	public archiveUrlIdentity!: string;

	@Column('integer')
	public checkpointLedger!: number;

	@Column('text')
	public status!: HistoryArchiveCheckpointProofStatus;

	@Column('smallint', { default: 1 })
	public proofVersion!: number;

	@Column('boolean')
	public requiredObjectsComplete!: boolean;

	@Column('boolean')
	public proofFactsComplete!: boolean;

	@Column('boolean')
	public checkpointBucketListMatches!: boolean;

	@Column('boolean')
	public transactionsMatch!: boolean;

	@Column('boolean')
	public resultsMatch!: boolean;

	@Column('boolean')
	public previousLedgersMatch!: boolean;

	@Column('boolean')
	public bucketsVerified!: boolean;

	@Column('integer')
	public ledgerFactCount!: number;

	@Column('integer')
	public transactionFactCount!: number;

	@Column('integer')
	public resultFactCount!: number;

	@Column('integer')
	public expectedBucketCount!: number;

	@Column('integer')
	public verifiedBucketCount!: number;

	@Column('integer')
	public failedBucketCount!: number;

	@Column('integer')
	public missingBucketCount!: number;

	@Column('text', { nullable: true })
	public checkpointBucketListHash!: string | null;

	@Column('text', { nullable: true })
	public ledgerBucketListHash!: string | null;

	@Column('uuid', { nullable: true })
	public checkpointStateObjectRemoteId!: string | null;

	@Column('uuid', { nullable: true })
	public ledgerObjectRemoteId!: string | null;

	@Column('uuid', { nullable: true })
	public transactionsObjectRemoteId!: string | null;

	@Column('uuid', { nullable: true })
	public resultsObjectRemoteId!: string | null;

	@Column('uuid', { nullable: true })
	public scpObjectRemoteId!: string | null;

	@Column('text', { nullable: true })
	public failureKind!: HistoryArchiveCheckpointProofFailureKind | null;

	@Column('jsonb', { nullable: true })
	public details!: Record<string, unknown> | null;

	@Column('timestamptz')
	public evaluatedAt!: Date;

	@CreateDateColumn({ type: 'timestamptz' })
	public readonly createdAt?: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	public readonly updatedAt?: Date;
}
