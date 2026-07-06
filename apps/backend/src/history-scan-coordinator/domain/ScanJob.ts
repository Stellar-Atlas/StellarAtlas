import { randomUUID } from 'node:crypto';
import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	Index
} from 'typeorm';

@Entity({ name: 'history_archive_scan_job_queue' })
@Index('idx_scanjob_status', ['status'])
@Index('idx_scanjob_url', ['url'])
@Index('idx_scanjob_remote_id', ['remoteId'], { unique: true })
export class ScanJob {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column({ type: 'uuid', nullable: false })
	public readonly remoteId: string;

	@Column()
	public url: string;

	@Column({ default: 0 })
	public latestScannedLedger: number;

	@Column({ type: 'varchar', nullable: true })
	public latestScannedLedgerHeaderHash: string | null;

	@Column({ type: 'timestamp', nullable: true })
	public chainInitDate: Date | null;

	@Column({ type: 'integer', nullable: true })
	public fromLedger: number | null;

	@Column({ type: 'integer', nullable: true })
	public toLedger: number | null;

	@Column({ type: 'integer', nullable: true })
	public concurrency: number | null;

	@Column({ type: 'integer', nullable: true })
	public latestAttemptedLedger: number | null;

	@Column({ type: 'integer', nullable: true })
	public currentRangeFromLedger: number | null;

	@Column({ type: 'integer', nullable: true })
	public currentRangeToLedger: number | null;

	@Column({ type: 'uuid', nullable: true })
	public claimedByCommunityScannerId: string | null;

	@Column({ type: 'timestamptz', nullable: true })
	public claimedAt: Date | null;

	@Column({ type: 'varchar', default: 'PENDING' })
	public status: 'PENDING' | 'TAKEN' | 'DONE';

	@CreateDateColumn()
	public createdAt?: Date;

	@UpdateDateColumn()
	public updatedAt?: Date;

	constructor(
		url: string,
		latestScannedLedger = 0,
		latestScannedLedgerHeaderHash: string | null = null,
		chainInitDate: Date | null = null,
		fromLedger: number | null = null,
		toLedger: number | null = null,
		concurrency: number | null = null,
		remoteId: string = randomUUID(),
		claimedByCommunityScannerId: string | null = null,
		claimedAt: Date | null = null,
		latestAttemptedLedger: number | null = null,
		currentRangeFromLedger: number | null = null,
		currentRangeToLedger: number | null = null
	) {
		this.remoteId = remoteId;
		this.url = url;
		this.latestScannedLedger = latestScannedLedger;
		this.latestScannedLedgerHeaderHash = latestScannedLedgerHeaderHash;
		this.chainInitDate = chainInitDate;
		this.fromLedger = fromLedger;
		this.toLedger = toLedger;
		this.concurrency = concurrency;
		this.latestAttemptedLedger = latestAttemptedLedger;
		this.currentRangeFromLedger = currentRangeFromLedger;
		this.currentRangeToLedger = currentRangeToLedger;
		this.claimedByCommunityScannerId = claimedByCommunityScannerId;
		this.claimedAt = claimedAt;
		this.status = 'PENDING';
	}

	public isNewScanChainJob(): boolean {
		return this.chainInitDate === null;
	}
}
