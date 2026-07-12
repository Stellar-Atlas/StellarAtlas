import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import type { ParsedTransactionResultDTO } from 'history-scanner-dto';
import { parsedLedgerSequenceTransformer } from '../ParsedHistoryInteger.js';

@Entity({ name: 'parsed_transaction_result' })
@Index(['ledgerSequence', 'transactionResultHash', 'transactionIndex'], {
	unique: true
})
@Index(['transactionHash'])
export class ParsedTransactionResult extends CoreEntity {
	@Column('bigint', { transformer: parsedLedgerSequenceTransformer })
	public readonly ledgerSequence!: number;

	@Column('integer')
	public readonly transactionIndex!: number;

	@Column('text')
	public readonly transactionResultHash!: string;

	@Column('text')
	public readonly transactionHash!: string;

	@Column('text')
	public readonly resultXdr!: string;

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
		result?: ParsedTransactionResultDTO,
		sourceArchiveUrl?: string,
		scanJobRemoteId?: string,
		observedAt?: Date
	) {
		super();
		if (
			result === undefined ||
			sourceArchiveUrl === undefined ||
			scanJobRemoteId === undefined ||
			observedAt === undefined
		) {
			return;
		}

		this.ledgerSequence = result.ledgerSequence;
		this.transactionIndex = result.transactionIndex;
		this.transactionResultHash = result.transactionResultHash;
		this.transactionHash = result.transactionHash;
		this.resultXdr = result.resultXdr;
		this.firstSourceArchiveUrl = sourceArchiveUrl;
		this.lastSourceArchiveUrl = sourceArchiveUrl;
		this.lastScanJobRemoteId = scanJobRemoteId;
		this.firstSeenAt = observedAt;
		this.lastSeenAt = observedAt;
	}
}
