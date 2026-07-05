import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import type { ScanEvidenceDTO } from 'history-scanner-dto';

export type ScanEvidenceKind = 'bucket';
export type ScanEvidenceStatus = 'verified';

@Entity({ name: 'history_archive_scan_evidence' })
@Index(['archiveUrl', 'observedAt'])
@Index(['scanJobRemoteId'])
export class ScanEvidence extends CoreEntity {
	@Column('integer')
	public readonly scanId!: number;

	@Column('text')
	public readonly archiveUrl!: string;

	@Column('text')
	public readonly scanJobRemoteId!: string;

	@Column('text')
	public readonly kind!: ScanEvidenceKind;

	@Column('text')
	public readonly status!: ScanEvidenceStatus;

	@Column('text')
	public readonly bucketHash!: string;

	@Column('text')
	public readonly bucketUrl!: string;

	@Column('timestamptz')
	public readonly observedAt!: Date;

	constructor(
		scanId?: number,
		archiveUrl?: string,
		scanJobRemoteId?: string,
		observedAt?: Date,
		dto?: ScanEvidenceDTO
	) {
		super();
		if (
			scanId === undefined ||
			archiveUrl === undefined ||
			scanJobRemoteId === undefined ||
			observedAt === undefined ||
			dto === undefined
		) {
			return;
		}

		this.scanId = scanId;
		this.archiveUrl = archiveUrl;
		this.scanJobRemoteId = scanJobRemoteId;
		this.kind = dto.kind;
		this.status = dto.status;
		this.bucketHash = dto.bucketHash;
		this.bucketUrl = dto.url;
		this.observedAt = observedAt;
	}
}
