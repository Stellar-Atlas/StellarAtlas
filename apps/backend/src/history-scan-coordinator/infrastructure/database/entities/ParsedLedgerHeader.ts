import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import type { ParsedLedgerHeaderDTO } from 'history-scanner-dto';

const maximumLedgerSequence = 0xffff_ffff;
const maximumProtocolVersion = 0x7fff_ffff;

const bigintTransformer = {
	from: (value: string | number): number =>
		assertIntegerInRange(
			typeof value === 'number' ? value : Number(value),
			maximumLedgerSequence,
			'ledgerSequence'
		),
	to: (value: number): number =>
		assertIntegerInRange(value, maximumLedgerSequence, 'ledgerSequence')
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

	@Column('timestamptz', { nullable: true })
	public readonly closedAt!: Date | null;

	@Column('text', { nullable: true })
	public readonly closedAtSourceArchiveUrl!: string | null;

	@Column('text', { nullable: true })
	public readonly closedAtScanJobRemoteId!: string | null;

	@Column('timestamptz', { nullable: true })
	public readonly closedAtObservedAt!: Date | null;

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
		this.ledgerSequence = assertIntegerInRange(
			header.ledgerSequence,
			maximumLedgerSequence,
			'ledgerSequence'
		);
		this.ledgerHeaderHash = assertNonEmpty(
			header.ledgerHeaderHash,
			'ledgerHeaderHash'
		);
		this.previousLedgerHeaderHash = assertNonEmpty(
			header.previousLedgerHeaderHash,
			'previousLedgerHeaderHash'
		);
		this.transactionSetHash = assertNonEmpty(
			header.transactionSetHash,
			'transactionSetHash'
		);
		this.transactionResultHash = assertNonEmpty(
			header.transactionResultHash,
			'transactionResultHash'
		);
		this.bucketListHash = assertNonEmpty(
			header.bucketListHash,
			'bucketListHash'
		);
		this.protocolVersion = assertIntegerInRange(
			header.protocolVersion,
			maximumProtocolVersion,
			'protocolVersion'
		);
		this.closedAt = toNullableDate(header.closedAt);
		this.closedAtSourceArchiveUrl =
			this.closedAt === null ? null : sourceArchiveUrl;
		this.closedAtScanJobRemoteId =
			this.closedAt === null ? null : scanJobRemoteId;
		this.closedAtObservedAt =
			this.closedAt === null ? null : toValidDate(observedAt, 'observedAt');
		this.firstSourceArchiveUrl = assertNonEmpty(
			sourceArchiveUrl,
			'sourceArchiveUrl'
		);
		this.lastSourceArchiveUrl = this.firstSourceArchiveUrl;
		this.lastScanJobRemoteId = assertNonEmpty(
			scanJobRemoteId,
			'scanJobRemoteId'
		);
		this.firstSeenAt = toValidDate(observedAt, 'observedAt');
		this.lastSeenAt = this.firstSeenAt;
	}
}

function toNullableDate(value: string | null | undefined): Date | null {
	return value === undefined || value === null
		? null
		: toValidDate(new Date(value), 'closedAt');
}

function assertIntegerInRange(
	value: number,
	maximum: number,
	field: string
): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RangeError(`${field} is outside its supported integer range`);
	}
	return value;
}

function assertNonEmpty(value: string, field: string): string {
	if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
	return value;
}

function toValidDate(value: Date, field: string): Date {
	if (Number.isNaN(value.getTime())) throw new Error(`${field} must be valid`);
	return new Date(value);
}
