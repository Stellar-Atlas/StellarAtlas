import { CoreEntity } from '@core/domain/CoreEntity.js';
import { Column, CreateDateColumn, Entity, Index, UpdateDateColumn } from 'typeorm';
import type {
	ArchiveMetadataDTO,
	HistoryArchiveStateDTO,
	HistoryStateBucketDTO
} from 'history-scanner-dto';

export type HistoryArchiveStateStatus =
	| 'available'
	| 'invalid'
	| 'unreachable';

export type HistoryArchiveStateSource =
	| 'backfill'
	| 'history-scanner'
	| 'network-scan';

export interface HistoryArchiveStateFailure {
	readonly message: string;
	readonly type: string;
	readonly httpStatus: number | null;
}

export interface HistoryArchiveStateLatestFailure
	extends HistoryArchiveStateFailure {
	readonly observedAt: Date;
	readonly source: HistoryArchiveStateSource;
}

export interface HistoryArchiveStateFailureInput {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly errorMessage: string;
	readonly errorType: string;
	readonly httpStatus?: number | null;
	readonly observedAt: Date;
	readonly source: HistoryArchiveStateSource;
	readonly stateUrl: string;
	readonly status: Exclude<HistoryArchiveStateStatus, 'available'>;
}

@Entity({ name: 'history_archive_state_snapshot' })
export class HistoryArchiveStateSnapshot extends CoreEntity {
	@Index()
	@Column('text')
	public readonly archiveUrl!: string;

	@Index({ unique: true })
	@Column('text')
	public readonly archiveUrlIdentity!: string;

	@Column('text')
	public readonly stateUrl!: string;

	@Index()
	@Column('text')
	public readonly status!: HistoryArchiveStateStatus;

	@Index()
	@Column('timestamptz')
	public readonly observedAt!: Date;

	@Column('text')
	public readonly source!: HistoryArchiveStateSource;

	@Column('integer', { nullable: true })
	public readonly version!: number | null;

	@Column('text', { nullable: true })
	public readonly server!: string | null;

	@Column('integer', { nullable: true })
	public readonly currentLedger!: number | null;

	@Column('text', { nullable: true })
	public readonly networkPassphrase!: string | null;

	@Column('jsonb', { nullable: true })
	public readonly currentBuckets!: readonly HistoryStateBucketDTO[] | null;

	@Column('jsonb', { nullable: true })
	public readonly hotArchiveBuckets!: readonly HistoryStateBucketDTO[] | null;

	@Column('jsonb', { nullable: true })
	public readonly rawState!: HistoryArchiveStateDTO | null;

	@Column('text', { nullable: true })
	public readonly errorType!: string | null;

	@Column('text', { nullable: true })
	public readonly errorMessage!: string | null;

	@Column('integer', { nullable: true })
	public readonly httpStatus!: number | null;

	@Column('timestamptz', { nullable: true })
	public readonly latestFailureObservedAt!: Date | null;

	@Column('text', { nullable: true })
	public readonly latestFailureSource!: HistoryArchiveStateSource | null;

	@Column('text', { nullable: true })
	public readonly latestFailureType!: string | null;

	@Column('text', { nullable: true })
	public readonly latestFailureMessage!: string | null;

	@Column('integer', { nullable: true })
	public readonly latestFailureHttpStatus!: number | null;

	@CreateDateColumn({ type: 'timestamptz' })
	public readonly createdAt?: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	public readonly updatedAt?: Date;

	constructor(props?: {
		readonly archiveUrl: string;
		readonly archiveUrlIdentity: string;
		readonly currentBuckets: readonly HistoryStateBucketDTO[] | null;
		readonly currentLedger: number | null;
		readonly errorMessage: string | null;
		readonly errorType: string | null;
		readonly hotArchiveBuckets: readonly HistoryStateBucketDTO[] | null;
		readonly httpStatus: number | null;
		readonly latestFailureHttpStatus: number | null;
		readonly latestFailureMessage: string | null;
		readonly latestFailureObservedAt: Date | null;
		readonly latestFailureSource: HistoryArchiveStateSource | null;
		readonly latestFailureType: string | null;
		readonly networkPassphrase: string | null;
		readonly observedAt: Date;
		readonly rawState: HistoryArchiveStateDTO | null;
		readonly server: string | null;
		readonly source: HistoryArchiveStateSource;
		readonly stateUrl: string;
		readonly status: HistoryArchiveStateStatus;
		readonly version: number | null;
	}) {
		super();
		if (props === undefined) return;

		this.archiveUrl = props.archiveUrl;
		this.archiveUrlIdentity = props.archiveUrlIdentity;
		this.currentBuckets = props.currentBuckets;
		this.currentLedger = props.currentLedger;
		this.errorMessage = props.errorMessage;
		this.errorType = props.errorType;
		this.hotArchiveBuckets = props.hotArchiveBuckets;
		this.httpStatus = props.httpStatus;
		this.latestFailureHttpStatus = props.latestFailureHttpStatus;
		this.latestFailureMessage = props.latestFailureMessage;
		this.latestFailureObservedAt = props.latestFailureObservedAt;
		this.latestFailureSource = props.latestFailureSource;
		this.latestFailureType = props.latestFailureType;
		this.networkPassphrase = props.networkPassphrase;
		this.observedAt = props.observedAt;
		this.rawState = props.rawState;
		this.server = props.server;
		this.source = props.source;
		this.stateUrl = props.stateUrl;
		this.status = props.status;
		this.version = props.version;
	}

	static available(
		archiveUrl: string,
		archiveUrlIdentity: string,
		archiveMetadata: ArchiveMetadataDTO,
		source: HistoryArchiveStateSource
	): HistoryArchiveStateSnapshot {
		const state = archiveMetadata.stellarHistory;

		return new HistoryArchiveStateSnapshot({
			archiveUrl,
			archiveUrlIdentity,
			currentBuckets: state.currentBuckets,
			currentLedger: state.currentLedger,
			errorMessage: null,
			errorType: null,
			hotArchiveBuckets: state.hotArchiveBuckets ?? null,
			httpStatus: null,
			latestFailureHttpStatus: null,
			latestFailureMessage: null,
			latestFailureObservedAt: null,
			latestFailureSource: null,
			latestFailureType: null,
			networkPassphrase: state.networkPassphrase ?? null,
			observedAt: new Date(archiveMetadata.observedAt),
			rawState: state,
			server: state.server,
			source,
			stateUrl: archiveMetadata.stellarHistoryUrl,
			status: 'available',
			version: state.version
		});
	}

	static failure(
		input: HistoryArchiveStateFailureInput
	): HistoryArchiveStateSnapshot {
		return new HistoryArchiveStateSnapshot({
			archiveUrl: input.archiveUrl,
			archiveUrlIdentity: input.archiveUrlIdentity,
			currentBuckets: null,
			currentLedger: null,
			errorMessage: input.errorMessage,
			errorType: input.errorType,
			hotArchiveBuckets: null,
			httpStatus: input.httpStatus ?? null,
			latestFailureHttpStatus: input.httpStatus ?? null,
			latestFailureMessage: input.errorMessage,
			latestFailureObservedAt: input.observedAt,
			latestFailureSource: input.source,
			latestFailureType: input.errorType,
			networkPassphrase: null,
			observedAt: input.observedAt,
			rawState: null,
			server: null,
			source: input.source,
			stateUrl: input.stateUrl,
			status: input.status,
			version: null
		});
	}

	toArchiveMetadata(): ArchiveMetadataDTO | null {
		if (this.status !== 'available' || this.rawState === null) return null;

		return {
			stellarHistoryUrl: this.stateUrl,
			stellarHistory: this.rawState,
			observedAt: this.observedAt.toISOString()
		};
	}

	toFailure(): HistoryArchiveStateFailure | null {
		if (this.status === 'available') return null;

		return {
			message: this.errorMessage ?? 'History archive state is unavailable',
			type: this.errorType ?? this.status,
			httpStatus: this.httpStatus
		};
	}

	toLatestFailure(): HistoryArchiveStateLatestFailure | null {
		if (
			this.latestFailureObservedAt === null ||
			this.latestFailureSource === null
		) {
			return null;
		}

		return {
			message:
				this.latestFailureMessage ?? 'History archive state is unavailable',
			type: this.latestFailureType ?? 'unreachable',
			httpStatus: this.latestFailureHttpStatus,
			observedAt: this.latestFailureObservedAt,
			source: this.latestFailureSource
		};
	}
}
