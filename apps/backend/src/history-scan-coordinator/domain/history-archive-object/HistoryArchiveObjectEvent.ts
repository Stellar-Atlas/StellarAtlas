import { CoreEntity } from '@core/domain/CoreEntity.js';
import { randomUUID } from 'node:crypto';
import {
	Column,
	CreateDateColumn,
	Entity,
	Index
} from 'typeorm';
import type {
	HistoryArchiveObjectType,
	HistoryArchiveObjectVerificationFacts
} from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectEvidenceClass } from './HistoryArchiveObjectRetryPolicy.js';

export type HistoryArchiveObjectEventType =
	| 'claimed'
	| 'heartbeat'
	| 'verified'
	| 'failed'
	| 'released';

@Entity({ name: 'history_archive_object_event' })
@Index('idx_history_archive_object_event_remote', ['objectRemoteId', 'createdAt'])
@Index('idx_history_archive_object_event_archive', [
	'archiveUrlIdentity',
	'createdAt'
])
@Index('idx_history_archive_object_event_type', ['eventType', 'createdAt'])
export class HistoryArchiveObjectEvent extends CoreEntity {
	@Index({ unique: true })
	@Column('uuid')
	public readonly remoteId!: string;

	@Column('uuid')
	public objectRemoteId!: string;

	@Column('text')
	public archiveUrl!: string;

	@Column('text')
	public archiveUrlIdentity!: string;

	@Column('text')
	public objectType!: HistoryArchiveObjectType;

	@Column('text')
	public objectKey!: string;

	@Column('text')
	public objectUrl!: string;

	@Column('text')
	public eventType!: HistoryArchiveObjectEventType;

	@Column('text', { nullable: true })
	public evidenceClass!: HistoryArchiveObjectEvidenceClass | null;

	@Column('text', { nullable: true })
	public workerStage!: string | null;

	@Column('integer', { nullable: true })
	public checkpointLedger!: number | null;

	@Column('text', { nullable: true })
	public bucketHash!: string | null;

	@Column('integer', { nullable: true })
	public bytesDownloaded!: number | null;

	@Column('integer', { nullable: true })
	public claimAttempt!: number | null;

	@Column('text', { nullable: true })
	public errorType!: string | null;

	@Column('text', { nullable: true })
	public errorMessage!: string | null;

	@Column('integer', { nullable: true })
	public httpStatus!: number | null;

	@Column('timestamptz', { nullable: true })
	public nextAttemptAt!: Date | null;

	@Column('jsonb', { nullable: true })
	public verificationFacts!: HistoryArchiveObjectVerificationFacts | null;

	@CreateDateColumn({ type: 'timestamptz' })
	public readonly createdAt?: Date;

	constructor(props?: {
		readonly archiveUrl: string;
		readonly archiveUrlIdentity: string;
		readonly bucketHash?: string | null;
		readonly bytesDownloaded?: number | null;
		readonly checkpointLedger?: number | null;
		readonly claimAttempt?: number | null;
		readonly errorMessage?: string | null;
		readonly errorType?: string | null;
		readonly eventType: HistoryArchiveObjectEventType;
		readonly evidenceClass?: HistoryArchiveObjectEvidenceClass | null;
		readonly httpStatus?: number | null;
		readonly nextAttemptAt?: Date | null;
		readonly objectKey: string;
		readonly objectRemoteId: string;
		readonly objectType: HistoryArchiveObjectType;
		readonly objectUrl: string;
		readonly remoteId?: string;
		readonly verificationFacts?: HistoryArchiveObjectVerificationFacts | null;
		readonly workerStage?: string | null;
	}) {
		super();
		if (props === undefined) return;

		this.remoteId = props.remoteId ?? randomUUID();
		this.objectRemoteId = props.objectRemoteId;
		this.archiveUrl = props.archiveUrl;
		this.archiveUrlIdentity = props.archiveUrlIdentity;
		this.bucketHash = props.bucketHash ?? null;
		this.bytesDownloaded = props.bytesDownloaded ?? null;
		this.checkpointLedger = props.checkpointLedger ?? null;
		this.claimAttempt = props.claimAttempt ?? null;
		this.errorMessage = props.errorMessage ?? null;
		this.errorType = props.errorType ?? null;
		this.eventType = props.eventType;
		this.evidenceClass = props.evidenceClass ?? null;
		this.httpStatus = props.httpStatus ?? null;
		this.nextAttemptAt = props.nextAttemptAt ?? null;
		this.objectKey = props.objectKey;
		this.objectType = props.objectType;
		this.objectUrl = props.objectUrl;
		this.verificationFacts = props.verificationFacts ?? null;
		this.workerStage = props.workerStage ?? null;
	}
}
