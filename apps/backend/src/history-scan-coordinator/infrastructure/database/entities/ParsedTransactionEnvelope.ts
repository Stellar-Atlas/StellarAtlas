import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import type { ParsedTransactionEnvelopeDTO } from 'history-scanner-dto';
import { parsedLedgerSequenceTransformer } from '../ParsedHistoryInteger.js';

@Entity({ name: 'parsed_transaction_envelope' })
@Index(['ledgerSequence', 'transactionSetHash', 'transactionIndex'], {
	unique: true
})
export class ParsedTransactionEnvelope extends CoreEntity {
	@Column('bigint', { transformer: parsedLedgerSequenceTransformer })
	public readonly ledgerSequence!: number;

	@Column('integer')
	public readonly transactionIndex!: number;

	@Column('text')
	public readonly transactionSetHash!: string;

	@Column('text')
	public readonly envelopeXdr!: string;

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
		envelope?: ParsedTransactionEnvelopeDTO,
		sourceArchiveUrl?: string,
		scanJobRemoteId?: string,
		observedAt?: Date
	) {
		super();
		if (
			envelope === undefined ||
			sourceArchiveUrl === undefined ||
			scanJobRemoteId === undefined ||
			observedAt === undefined
		) {
			return;
		}

		this.ledgerSequence = envelope.ledgerSequence;
		this.transactionIndex = envelope.transactionIndex;
		this.transactionSetHash = envelope.transactionSetHash;
		this.envelopeXdr = envelope.envelopeXdr;
		this.firstSourceArchiveUrl = sourceArchiveUrl;
		this.lastSourceArchiveUrl = sourceArchiveUrl;
		this.lastScanJobRemoteId = scanJobRemoteId;
		this.firstSeenAt = observedAt;
		this.lastSeenAt = observedAt;
	}
}
