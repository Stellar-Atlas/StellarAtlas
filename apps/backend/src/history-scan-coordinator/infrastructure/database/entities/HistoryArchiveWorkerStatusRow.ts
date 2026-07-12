import { CoreEntity } from '@core/domain/CoreEntity.js';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'history_archive_worker_status' })
@Index('uq_history_archive_worker_status_worker', ['workerId'], {
	unique: true
})
@Index('idx_history_archive_worker_status_heartbeat', ['heartbeatAt'])
export class HistoryArchiveWorkerStatusRow extends CoreEntity {
	@Column('varchar', { length: 96 })
	public workerId!: string;

	@Column('uuid')
	public processId!: string;

	@Column('integer')
	public pid!: number;

	@Column('integer')
	public processGeneration!: number;

	@Column('timestamptz')
	public processStartedAt!: Date;

	@Column('bigint')
	public sequence!: number;

	@Column('uuid', { nullable: true })
	public objectRemoteId!: string | null;

	@Column('smallint', { nullable: true })
	public objectTypeCode!: number | null;

	@Column('varchar', { length: 2048, nullable: true })
	public objectSource!: string | null;

	@Column('smallint')
	public stageCode!: number;

	@Column('bigint', { nullable: true })
	public bytesDownloaded!: number | null;

	@Column('integer', { nullable: true })
	public claimAttempt!: number | null;

	@Column('timestamptz')
	public heartbeatAt!: Date;

	@Column('smallint')
	public lastOutcomeCode!: number;

	@Column('timestamptz', { nullable: true })
	public lastOutcomeAt!: Date | null;
}
