import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import type { ParsedLedgerHeaderDTO } from 'history-scanner-dto';

const bigintTransformer = {
	from: (value: string | number): number =>
		typeof value === 'number' ? value : Number(value),
	to: (value: number): number => value
};

@Entity({ name: 'parsed_ledger_header' })
@Index(['ledgerSequence', 'ledgerHeaderHash'], { unique: true })
export class ParsedLedgerHeader extends CoreEntity {
	@Column('bigint', { transformer: bigintTransformer })
	public readonly ledgerSequence!: number;

	@Column('text')
	public readonly ledgerHeaderHash!: string;

	@Column('text')
	public readonly previousLedgerHeaderHash!: string;

	@Column('text')
	public readonly transactionSetHash!: string;

	@Column('text')
	public readonly transactionResultHash!: string;

	@Column('text')
	public readonly bucketListHash!: string;

	@Column('integer')
	public readonly protocolVersion!: number;

	@Column('text')
	public readonly firstSourceArchiveUrl!: string;

	@Column('text')
	public readonly lastSourceArchiveUrl!: string;

	@Column('text')
	public readonly lastScanJobRemoteId!: string;

	@Column('timestamptz')
	public readonly firstSeenAt!: Date;

	@Column('timestamptz')
	public readonly lastSeenAt!: Date;

	constructor(
		header?: ParsedLedgerHeaderDTO,
		sourceArchiveUrl?: string,
		scanJobRemoteId?: string,
		observedAt?: Date
	) {
		super();
		if (
			header === undefined ||
			sourceArchiveUrl === undefined ||
			scanJobRemoteId === undefined ||
			observedAt === undefined
		) {
			return;
		}
		this.ledgerSequence = header.ledgerSequence;
		this.ledgerHeaderHash = header.ledgerHeaderHash;
		this.previousLedgerHeaderHash = header.previousLedgerHeaderHash;
		this.transactionSetHash = header.transactionSetHash;
		this.transactionResultHash = header.transactionResultHash;
		this.bucketListHash = header.bucketListHash;
		this.protocolVersion = header.protocolVersion;
		this.firstSourceArchiveUrl = sourceArchiveUrl;
		this.lastSourceArchiveUrl = sourceArchiveUrl;
		this.lastScanJobRemoteId = scanJobRemoteId;
		this.firstSeenAt = observedAt;
		this.lastSeenAt = observedAt;
	}
}
