import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveObjectEvidenceClassV1,
	HistoryArchiveObjectFailureClassV1,
	HistoryArchiveObjectHostThrottleV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type HostThrottleRow = {
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly blockedUntil?: Date | string;
	readonly blockeduntil?: Date | string;
	readonly consecutiveFailures?: NumericValue;
	readonly consecutivefailures?: NumericValue;
	readonly errorType?: string;
	readonly errortype?: string;
	readonly evidenceClass?: string;
	readonly evidenceclass?: string;
	readonly failureClass?: string;
	readonly failureclass?: string;
	readonly hostIdentity?: string;
	readonly hostidentity?: string;
	readonly httpStatus?: NumericValue | null;
	readonly httpstatus?: NumericValue | null;
	readonly lastFailureAt?: Date | string;
	readonly lastfailureat?: Date | string;
};

export async function getHistoryArchiveObjectHostThrottles(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveObjectHostThrottleV1[]> {
	const rows = (await manager.query(hostThrottleSql, [
		archiveUrlIdentity
	])) as readonly HostThrottleRow[];

	return rows.map(mapHostThrottleRow);
}

function mapHostThrottleRow(
	row: HostThrottleRow
): HistoryArchiveObjectHostThrottleV1 {
	return {
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		blockedUntil: requireDateString(
			row.blockedUntil ?? row.blockeduntil,
			'blockedUntil'
		),
		consecutiveFailures: requireNumber(
			row.consecutiveFailures ?? row.consecutivefailures,
			'consecutiveFailures'
		),
		errorType: requireString(row.errorType ?? row.errortype, 'errorType'),
		evidenceClass: requireEvidenceClass(row.evidenceClass ?? row.evidenceclass),
		failureClass: requireFailureClass(row.failureClass ?? row.failureclass),
		hostIdentity: requireString(
			row.hostIdentity ?? row.hostidentity,
			'hostIdentity'
		),
		httpStatus: toNullableNumber(row.httpStatus ?? row.httpstatus),
		lastFailureAt: requireDateString(
			row.lastFailureAt ?? row.lastfailureat,
			'lastFailureAt'
		)
	};
}

function toNullableNumber(
	value: NumericValue | null | undefined
): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, 'httpStatus');
}

function requireString(value: string | undefined, label: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive object host throttle row is missing ${label}`);
}

function requireDateString(
	value: Date | string | undefined,
	label: string
): string {
	if (value instanceof Date) return value.toISOString();
	return requireString(value, label);
}

function requireFailureClass(
	value: string | undefined
): HistoryArchiveObjectFailureClassV1 {
	if (
		value === 'http' ||
		value === 'auth' ||
		value === 'not-found' ||
		value === 'rate-limit' ||
		value === 'timeout' ||
		value === 'transport' ||
		value === 'worker' ||
		value === 'coordinator' ||
		value === 'unknown'
	) {
		return value;
	}

	throw new Error('Archive object host throttle row has invalid failure class');
}

function requireEvidenceClass(
	value: string | undefined
): HistoryArchiveObjectEvidenceClassV1 {
	if (
		value === 'archive-object' ||
		value === 'worker-infrastructure' ||
		value === 'coordinator-infrastructure'
	) {
		return value;
	}

	throw new Error(
		'Archive object host throttle row has invalid evidence class'
	);
}

const hostThrottleSql = `
	select
		"archiveUrlIdentity",
		"blockedUntil",
		"consecutiveFailures",
		"errorType",
		"evidenceClass",
		"failureClass",
		"hostIdentity",
		"httpStatus",
		"lastFailureAt"
	from history_archive_object_host_throttle
	where ($1::text is null or "archiveUrlIdentity" = $1::text)
		and "blockedUntil" > now()
	order by "blockedUntil" desc, "hostIdentity" asc
	limit 20
`;
