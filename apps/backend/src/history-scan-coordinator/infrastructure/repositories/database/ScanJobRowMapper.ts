import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';

export type NumericValue = number | string;

type ScanJobRow = {
	id: number;
	remoteId: string;
	url: string;
	latestScannedLedger: number;
	latestScannedLedgerHeaderHash: string | null;
	chainInitDate: Date | null;
	fromLedger: number | null;
	toLedger: number | null;
	concurrency: number | null;
	latestAttemptedLedger: number | null;
	currentRangeFromLedger: number | null;
	currentRangeToLedger: number | null;
	claimedByCommunityScannerId: string | null;
	claimedAt: Date | null;
	status: 'PENDING' | 'TAKEN' | 'DONE';
	createdAt: Date;
	updatedAt: Date;
};

export type RawScanJobRow = Partial<ScanJobRow> & {
	id?: NumericValue;
	remoteid?: string;
	latestScannedLedger?: NumericValue;
	latestscannedledger?: NumericValue;
	latestscannedledgerheaderhash?: string | null;
	chaininitdate?: Date | string | null;
	fromLedger?: NumericValue | null;
	fromledger?: NumericValue | null;
	toLedger?: NumericValue | null;
	toledger?: NumericValue | null;
	concurrency?: NumericValue | null;
	latestAttemptedLedger?: NumericValue | null;
	latestattemptedledger?: NumericValue | null;
	currentRangeFromLedger?: NumericValue | null;
	currentrangefromledger?: NumericValue | null;
	currentRangeToLedger?: NumericValue | null;
	currentrangetoledger?: NumericValue | null;
	claimedbycommunityscannerid?: string | null;
	claimedat?: Date | string | null;
	createdat?: Date | string;
	updatedat?: Date | string;
};

export type RawQueueStatsRow = {
	pendingJobs?: NumericValue;
	pendingjobs?: NumericValue;
	activeJobs?: NumericValue;
	activejobs?: NumericValue;
	staleJobs?: NumericValue;
	stalejobs?: NumericValue;
	totalUnfinishedJobs?: NumericValue;
	totalunfinishedjobs?: NumericValue;
};

export type RawTakenJobStatsRow = {
	activeTakenJobs?: NumericValue;
	activetakenjobs?: NumericValue;
	staleTakenJobs?: NumericValue;
	staletakenjobs?: NumericValue;
	totalTakenJobs?: NumericValue;
	totaltakenjobs?: NumericValue;
};

export type RawQueryResult =
	| RawScanJobRow[]
	| [RawScanJobRow[], number]
	| { raw: RawScanJobRow[] }
	| { records: RawScanJobRow[] };

type RawQueryArray = RawScanJobRow[] | [RawScanJobRow[], number];

export function createScanJobFromRow(row: RawScanJobRow): ScanJob {
	const scanJobRow = normalizeScanJobRow(row);
	const scanJob = new ScanJob(
		scanJobRow.url,
		scanJobRow.latestScannedLedger,
		scanJobRow.latestScannedLedgerHeaderHash,
		scanJobRow.chainInitDate,
		scanJobRow.fromLedger,
		scanJobRow.toLedger,
		scanJobRow.concurrency,
		scanJobRow.remoteId,
		scanJobRow.claimedByCommunityScannerId,
		scanJobRow.claimedAt,
		scanJobRow.latestAttemptedLedger,
		scanJobRow.currentRangeFromLedger,
		scanJobRow.currentRangeToLedger
	);
	scanJob.id = scanJobRow.id;
	scanJob.status = scanJobRow.status;
	scanJob.createdAt = scanJobRow.createdAt;
	scanJob.updatedAt = scanJobRow.updatedAt;
	return scanJob;
}

export function extractQueryRows(result: RawQueryResult): RawScanJobRow[] {
	if (Array.isArray(result)) {
		if (isStructuredQueryArray(result)) {
			return result[0];
		}

		return result;
	}

	if ('records' in result) return result.records;

	return result.raw;
}

export function requireNumber(
	value: NumericValue | undefined,
	field: string
): number {
	const numberValue = parseNumber(value);
	if (numberValue === null) {
		throw new Error(`Scan job row is missing numeric field ${field}`);
	}

	return numberValue;
}

function normalizeScanJobRow(row: RawScanJobRow): ScanJobRow {
	return {
		id: requireNumber(row.id, 'id'),
		remoteId: requireString(row.remoteId ?? row.remoteid, 'remoteId'),
		url: requireString(row.url, 'url'),
		latestScannedLedger: requireNumber(
			row.latestScannedLedger ?? row.latestscannedledger,
			'latestScannedLedger'
		),
		latestScannedLedgerHeaderHash:
			row.latestScannedLedgerHeaderHash ??
			row.latestscannedledgerheaderhash ??
			null,
		chainInitDate: toNullableDate(
			row.chainInitDate === undefined ? row.chaininitdate : row.chainInitDate
		),
		fromLedger: toNullableNumber(
			row.fromLedger === undefined ? row.fromledger : row.fromLedger
		),
		toLedger: toNullableNumber(
			row.toLedger === undefined ? row.toledger : row.toLedger
		),
		concurrency: toNullableNumber(row.concurrency),
		latestAttemptedLedger: toNullableNumber(
			row.latestAttemptedLedger === undefined
				? row.latestattemptedledger
				: row.latestAttemptedLedger
		),
		currentRangeFromLedger: toNullableNumber(
			row.currentRangeFromLedger === undefined
				? row.currentrangefromledger
				: row.currentRangeFromLedger
		),
		currentRangeToLedger: toNullableNumber(
			row.currentRangeToLedger === undefined
				? row.currentrangetoledger
				: row.currentRangeToLedger
		),
		claimedByCommunityScannerId:
			row.claimedByCommunityScannerId ??
			row.claimedbycommunityscannerid ??
			null,
		claimedAt: toNullableDate(
			row.claimedAt === undefined ? row.claimedat : row.claimedAt
		),
		status: requireStatus(row.status),
		createdAt: requireDate(row.createdAt ?? row.createdat, 'createdAt'),
		updatedAt: requireDate(row.updatedAt ?? row.updatedat, 'updatedAt')
	};
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Scan job row is missing string field ${field}`);
	}

	return value;
}

function requireStatus(
	value: string | undefined
): 'PENDING' | 'TAKEN' | 'DONE' {
	if (value === 'PENDING' || value === 'TAKEN' || value === 'DONE') {
		return value;
	}

	throw new Error('Scan job row is missing status');
}

function requireDate(value: Date | string | undefined, field: string): Date {
	const date = toNullableDate(value);
	if (date === null || Number.isNaN(date.getTime())) {
		throw new Error(`Scan job row is missing date field ${field}`);
	}

	return date;
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value;

	return new Date(value);
}

function toNullableNumber(
	value: NumericValue | null | undefined
): number | null {
	if (value === null || value === undefined) return null;

	return parseNumber(value);
}

function parseNumber(value: NumericValue | undefined): number | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) ? value : null;
	}

	if (typeof value === 'string' && /^\d+$/.test(value)) {
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) ? parsed : null;
	}

	return null;
}

function isStructuredQueryArray(
	result: RawQueryArray
): result is [RawScanJobRow[], number] {
	return Array.isArray(result[0]) && typeof result[1] === 'number';
}
