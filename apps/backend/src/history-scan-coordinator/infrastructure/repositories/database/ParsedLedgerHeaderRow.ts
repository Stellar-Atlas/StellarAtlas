import type { ParsedLedgerHeaderDetails } from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';

const maximumLedgerSequence = 0xffff_ffff;
const maximumProtocolVersion = 0x7fff_ffff;

export const parsedLedgerHeaderDetailsColumns = `
	"bucketListHash", "closedAt", "closedAtObservedAt",
	"closedAtScanJobRemoteId", "closedAtSourceArchiveUrl", "firstSeenAt",
	"firstSourceArchiveUrl", "lastScanJobRemoteId", "lastSeenAt",
	"lastSourceArchiveUrl", "ledgerHeaderHash", "ledgerSequence",
	"previousLedgerHeaderHash", "protocolVersion", "transactionResultHash",
	"transactionSetHash"
`;

export interface ParsedLedgerHeaderDetailsRow {
	readonly bucketListHash: string;
	readonly closedAt: Date | string | null;
	readonly closedAtObservedAt: Date | string | null;
	readonly closedAtScanJobRemoteId: string | null;
	readonly closedAtSourceArchiveUrl: string | null;
	readonly firstSeenAt: Date | string;
	readonly firstSourceArchiveUrl: string;
	readonly lastSourceArchiveUrl: string;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: string | number;
	readonly lastScanJobRemoteId: string;
	readonly lastSeenAt: Date | string;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: string | number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export function mapParsedLedgerHeaderDetails(
	row: ParsedLedgerHeaderDetailsRow
): ParsedLedgerHeaderDetails {
	return {
		bucketListHash: row.bucketListHash,
		closedAt: toNullableDate(row.closedAt),
		closedAtObservedAt: toNullableDate(row.closedAtObservedAt),
		closedAtScanJobRemoteId: row.closedAtScanJobRemoteId,
		closedAtSourceArchiveUrl: row.closedAtSourceArchiveUrl,
		firstSeenAt: toParsedHistoryDate(row.firstSeenAt),
		firstSourceArchiveUrl: row.firstSourceArchiveUrl,
		lastScanJobRemoteId: row.lastScanJobRemoteId,
		lastSeenAt: toParsedHistoryDate(row.lastSeenAt),
		lastSourceArchiveUrl: row.lastSourceArchiveUrl,
		ledgerHeaderHash: row.ledgerHeaderHash,
		ledgerSequence: toIntegerInRange(
			row.ledgerSequence,
			maximumLedgerSequence,
			'ledgerSequence'
		),
		previousLedgerHeaderHash: row.previousLedgerHeaderHash,
		protocolVersion: toIntegerInRange(
			row.protocolVersion,
			maximumProtocolVersion,
			'protocolVersion'
		),
		transactionResultHash: row.transactionResultHash,
		transactionSetHash: row.transactionSetHash
	};
}

function toIntegerInRange(
	value: number | string,
	maximum: number,
	field: string
): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
		throw new RangeError(`${field} is outside its supported integer range`);
	}
	return parsed;
}

export function toParsedHistoryDate(value: Date | string): Date {
	const date = new Date(value.valueOf());
	if (Number.isNaN(date.getTime())) throw new Error('Invalid stored timestamp');
	return date;
}

function toNullableDate(value: Date | string | null): Date | null {
	return value === null ? null : toParsedHistoryDate(value);
}
