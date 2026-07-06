import { CoreEntity } from '@core/domain/CoreEntity.js';
import { randomUUID } from 'node:crypto';
import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	UpdateDateColumn
} from 'typeorm';
import type {
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import { getHistoryArchiveObjectHostIdentity } from './HistoryArchiveObjectHostIdentity.js';

export type HistoryArchiveObjectType = HistoryArchiveObjectTypeV1;
export type HistoryArchiveObjectStatus = HistoryArchiveObjectStatusV1;

export interface HistoryArchiveObjectError {
	readonly message: string;
	readonly type: string;
	readonly httpStatus: number | null;
}

export type HistoryArchiveObjectVerificationFacts = object;

@Entity({ name: 'history_archive_object_queue' })
@Index('idx_history_archive_object_status', ['status', 'objectOrder'])
@Index('idx_history_archive_object_archive', ['archiveUrlIdentity', 'status'])
@Index('idx_history_archive_object_host', ['hostIdentity', 'status'])
@Index('idx_history_archive_object_key', ['objectType', 'objectKey'])
@Index(
	'uq_history_archive_object_identity',
	['archiveUrlIdentity', 'objectType', 'objectKey'],
	{ unique: true }
)
export class HistoryArchiveObject extends CoreEntity {
	@Index({ unique: true })
	@Column('uuid')
	public readonly remoteId!: string;

	@Column('text')
	public archiveUrl!: string;

	@Column('text')
	public archiveUrlIdentity!: string;

	@Column('text')
	public hostIdentity!: string;

	@Column('text')
	public objectType!: HistoryArchiveObjectType;

	@Column('text')
	public objectKey!: string;

	@Column('integer')
	public objectOrder!: number;

	@Column('text')
	public objectUrl!: string;

	@Column('text', { default: 'pending' })
	public status!: HistoryArchiveObjectStatus;

	@Column('text', { nullable: true })
	public workerStage!: string | null;

	@Column('integer', { nullable: true })
	public checkpointLedger!: number | null;

	@Column('text', { nullable: true })
	public bucketHash!: string | null;

	@Column('bigint', { nullable: true })
	public bytesDownloaded!: number | null;

	@Column('integer', { default: 0 })
	public attempts!: number;

	@Column('timestamptz', { nullable: true })
	public nextAttemptAt!: Date | null;

	@Column('timestamptz', { nullable: true })
	public refreshAfter!: Date | null;

	@Column('timestamptz', { nullable: true })
	public claimedAt!: Date | null;

	@Column('uuid', { nullable: true })
	public claimedByCommunityScannerId!: string | null;

	@Column('text', { nullable: true })
	public errorType!: string | null;

	@Column('text', { nullable: true })
	public errorMessage!: string | null;

	@Column('integer', { nullable: true })
	public httpStatus!: number | null;

	@Column('jsonb', { nullable: true })
	public verificationFacts!: HistoryArchiveObjectVerificationFacts | null;

	@Column('timestamptz', { nullable: true })
	public verifiedAt!: Date | null;

	@CreateDateColumn({ type: 'timestamptz' })
	public readonly createdAt?: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	public readonly updatedAt?: Date;

	constructor(props?: {
		readonly archiveUrl: string;
		readonly archiveUrlIdentity: string;
		readonly bucketHash?: string | null;
		readonly checkpointLedger?: number | null;
		readonly hostIdentity?: string;
		readonly objectKey: string;
		readonly objectOrder: number;
		readonly objectType: HistoryArchiveObjectType;
		readonly objectUrl: string;
		readonly remoteId?: string;
		readonly status?: HistoryArchiveObjectStatus;
	}) {
		super();
		if (props === undefined) return;

		this.remoteId = props.remoteId ?? randomUUID();
		this.archiveUrl = props.archiveUrl;
		this.archiveUrlIdentity = props.archiveUrlIdentity;
		this.hostIdentity =
			props.hostIdentity ?? getHistoryArchiveObjectHostIdentity(props.archiveUrl);
		this.bucketHash = props.bucketHash ?? null;
		this.checkpointLedger = props.checkpointLedger ?? null;
		this.objectKey = props.objectKey;
		this.objectOrder = props.objectOrder;
		this.objectType = props.objectType;
		this.objectUrl = props.objectUrl;
		this.status = props.status ?? 'pending';
		this.workerStage = null;
		this.bytesDownloaded = null;
		this.attempts = 0;
		this.nextAttemptAt = null;
		this.refreshAfter = null;
		this.claimedAt = null;
		this.claimedByCommunityScannerId = null;
		this.errorType = null;
		this.errorMessage = null;
		this.httpStatus = null;
		this.verificationFacts = null;
		this.verifiedAt = null;
	}
}
