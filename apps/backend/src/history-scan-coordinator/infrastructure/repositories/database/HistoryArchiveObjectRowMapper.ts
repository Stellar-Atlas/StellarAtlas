import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectDelayReasonCodeV1 } from 'shared';
import type { NumericValue } from './ScanJobRowMapper.js';
import { requireNumber } from './ScanJobRowMapper.js';

export type RawObjectStatsRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly failedObjects?: NumericValue;
	readonly failedobjects?: NumericValue;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
};

type RawObjectRow = {
	readonly remoteId?: string;
	readonly remoteid?: string;
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly hostIdentity?: string;
	readonly hostidentity?: string;
	readonly objectType?: string;
	readonly objecttype?: string;
	readonly objectKey?: string;
	readonly objectkey?: string;
	readonly objectOrder?: NumericValue;
	readonly objectorder?: NumericValue;
	readonly objectUrl?: string;
	readonly objecturl?: string;
	readonly status?: string;
	readonly workerStage?: string | null;
	readonly workerstage?: string | null;
	readonly checkpointLedger?: NumericValue | null;
	readonly checkpointledger?: NumericValue | null;
	readonly bucketHash?: string | null;
	readonly buckethash?: string | null;
	readonly bytesDownloaded?: NumericValue | null;
	readonly bytesdownloaded?: NumericValue | null;
	readonly attempts?: NumericValue;
	readonly nextAttemptAt?: Date | string | null;
	readonly nextattemptat?: Date | string | null;
	readonly refreshAfter?: Date | string | null;
	readonly refreshafter?: Date | string | null;
	readonly claimedAt?: Date | string | null;
	readonly claimedat?: Date | string | null;
	readonly claimedByCommunityScannerId?: string | null;
	readonly claimedbycommunityscannerid?: string | null;
	readonly errorType?: string | null;
	readonly errortype?: string | null;
	readonly errorMessage?: string | null;
	readonly errormessage?: string | null;
	readonly httpStatus?: NumericValue | null;
	readonly httpstatus?: NumericValue | null;
	readonly verificationFacts?: Record<string, unknown> | null;
	readonly verificationfacts?: Record<string, unknown> | null;
	readonly verifiedAt?: Date | string | null;
	readonly verifiedat?: Date | string | null;
	readonly createdAt?: Date | string;
	readonly createdat?: Date | string;
	readonly updatedAt?: Date | string;
	readonly updatedat?: Date | string;
	readonly delayReasonCode?: string | null;
	readonly delayreasoncode?: string | null;
	readonly delayReasonUntil?: Date | string | null;
	readonly delayreasonuntil?: Date | string | null;
};

export type RawObjectQueryResult =
	| RawObjectRow[]
	| [RawObjectRow[], number]
	| { raw: RawObjectRow[] }
	| { records: RawObjectRow[] };

type RawObjectQueryArray = RawObjectRow[] | [RawObjectRow[], number];

export function createObjectFromRow(row: RawObjectRow): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		bucketHash: row.bucketHash ?? row.buckethash ?? null,
		checkpointLedger: toNullableNumber(
			row.checkpointLedger === undefined
				? row.checkpointledger
				: row.checkpointLedger
		),
		hostIdentity: requireString(
			row.hostIdentity ?? row.hostidentity,
			'hostIdentity'
		),
		objectKey: requireString(row.objectKey ?? row.objectkey, 'objectKey'),
		objectOrder: requireNumber(
			row.objectOrder ?? row.objectorder,
			'objectOrder'
		),
		objectType: requireObjectType(row.objectType ?? row.objecttype),
		objectUrl: requireString(row.objectUrl ?? row.objecturl, 'objectUrl'),
		remoteId: requireString(row.remoteId ?? row.remoteid, 'remoteId'),
		status: requireObjectStatus(row.status)
	});
	object.workerStage = row.workerStage ?? row.workerstage ?? null;
	object.bytesDownloaded = toNullableNumber(
		row.bytesDownloaded === undefined
			? row.bytesdownloaded
			: row.bytesDownloaded
	);
	object.attempts = requireNumber(row.attempts, 'attempts');
	object.nextAttemptAt = toNullableDate(
		row.nextAttemptAt === undefined ? row.nextattemptat : row.nextAttemptAt
	);
	object.refreshAfter = toNullableDate(
		row.refreshAfter === undefined ? row.refreshafter : row.refreshAfter
	);
	object.claimedAt = toNullableDate(
		row.claimedAt === undefined ? row.claimedat : row.claimedAt
	);
	object.claimedByCommunityScannerId =
		row.claimedByCommunityScannerId ?? row.claimedbycommunityscannerid ?? null;
	object.errorType = row.errorType ?? row.errortype ?? null;
	object.errorMessage = row.errorMessage ?? row.errormessage ?? null;
	object.httpStatus = toNullableNumber(
		row.httpStatus === undefined ? row.httpstatus : row.httpStatus
	);
	object.verificationFacts =
		row.verificationFacts === undefined
			? (row.verificationfacts ?? null)
			: row.verificationFacts;
	object.verifiedAt = toNullableDate(
		row.verifiedAt === undefined ? row.verifiedat : row.verifiedAt
	);
	(object as HistoryArchiveObject & { createdAt?: Date }).createdAt =
		requireDate(row.createdAt ?? row.createdat, 'createdAt');
	(object as HistoryArchiveObject & { updatedAt?: Date }).updatedAt =
		requireDate(row.updatedAt ?? row.updatedat, 'updatedAt');
	const delayReasonCode = toDelayReasonCode(
		row.delayReasonCode ?? row.delayreasoncode ?? null
	);
	object.delayReason =
		delayReasonCode === null
			? null
			: {
					code: delayReasonCode,
					until: toNullableDate(
						row.delayReasonUntil === undefined
							? row.delayreasonuntil
							: row.delayReasonUntil
					)?.toISOString() ?? null
				};

	return object;
}

export function extractRows(result: RawObjectQueryResult): RawObjectRow[] {
	if (Array.isArray(result)) {
		if (isStructuredQueryArray(result)) return result[0];

		return result as RawObjectRow[];
	}

	if ('records' in result) return result.records;

	return result.raw;
}

export function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 250;
	return Math.min(limit, 5000);
}

export function statusRankSql(alias: string): string {
	return `
		case ${alias}
			when 'scanning' then 0
			when 'failed' then 1
			when 'pending' then 2
			when 'verified' then 3
			else 4
		end
	`;
}

function isStructuredQueryArray(
	result: RawObjectQueryArray
): result is [RawObjectRow[], number] {
	return Array.isArray(result[0]) && typeof result[1] === 'number';
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Archive object row is missing string field ${field}`);
	}

	return value;
}

function requireDate(value: Date | string | undefined, field: string): Date {
	const date = toNullableDate(value);
	if (date === null || Number.isNaN(date.getTime())) {
		throw new Error(`Archive object row is missing date field ${field}`);
	}

	return date;
}

function requireObjectType(
	value: string | undefined
): HistoryArchiveObjectType {
	if (
		value === 'history-archive-state' ||
		value === 'checkpoint-state' ||
		value === 'ledger' ||
		value === 'transactions' ||
		value === 'results' ||
		value === 'scp' ||
		value === 'bucket'
	) {
		return value;
	}

	throw new Error('Archive object row is missing object type');
}

function requireObjectStatus(
	value: string | undefined
): HistoryArchiveObject['status'] {
	if (
		value === 'pending' ||
		value === 'scanning' ||
		value === 'verified' ||
		value === 'failed'
	) {
		return value;
	}

	throw new Error('Archive object row is missing status');
}

function toDelayReasonCode(
	value: string | null
): HistoryArchiveObjectDelayReasonCodeV1 | null {
	if (value === null) return null;
	if (
		value === 'archive-active-cap' ||
		value === 'global-active-cap' ||
		value === 'host-active-cap' ||
		value === 'host-backoff' ||
		value === 'missing-dependency' ||
		value === 'object-already-active' ||
		value === 'retry-window'
	) {
		return value;
	}

	throw new Error('Archive object row has invalid delay reason code');
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
	const parsed = Number(value);

	return Number.isSafeInteger(parsed) ? parsed : null;
}
