import { DataSource } from 'typeorm';
import type {
	CommunityScannerRegistrationThrottleRepository,
	CommunityScannerRegistrationThrottleSnapshot
} from '@history-scan-coordinator/domain/CommunityScannerRegistrationThrottle.js';

type RawThrottleRow = {
	readonly attemptCount?: number | string;
	readonly attemptcount?: number | string;
	readonly windowStartedAt?: Date | string;
	readonly windowstartedat?: Date | string;
};

type RawThrottleQueryResult =
	| RawThrottleRow[]
	| [RawThrottleRow[], number]
	| { raw: RawThrottleRow[] }
	| { records: RawThrottleRow[] };
type RawThrottleQueryArray = RawThrottleRow[] | [RawThrottleRow[], number];
type RawDeletedThrottleRow = {
	readonly sourceIpHash?: string;
	readonly sourceiphash?: string;
};
type RawDeletedThrottleQueryResult =
	| RawDeletedThrottleRow[]
	| [RawDeletedThrottleRow[], number]
	| { raw: RawDeletedThrottleRow[] }
	| { records: RawDeletedThrottleRow[] };
type RawDeletedThrottleQueryArray =
	| RawDeletedThrottleRow[]
	| [RawDeletedThrottleRow[], number];

export class TypeOrmCommunityScannerRegistrationThrottleRepository
	implements CommunityScannerRegistrationThrottleRepository
{
	constructor(private readonly dataSource: DataSource) {}

	async recordAttempt(
		sourceIpHash: string,
		now: Date,
		windowMs: number
	): Promise<CommunityScannerRegistrationThrottleSnapshot> {
		const resetBefore = new Date(now.getTime() - windowMs);
		const rows = extractThrottleRows(
			(await this.dataSource.query(
				`
				insert into community_scanner_registration_throttles (
					source_ip_hash,
					window_started_at,
					attempt_count,
					created_at,
					updated_at
				)
				values ($1, $2, 1, $2, $2)
				on conflict (source_ip_hash) do update set
					window_started_at = case
						when community_scanner_registration_throttles.window_started_at <= $3
							then $2
						else community_scanner_registration_throttles.window_started_at
					end,
					attempt_count = case
						when community_scanner_registration_throttles.window_started_at <= $3
							then 1
						else community_scanner_registration_throttles.attempt_count + 1
					end,
					updated_at = $2
				returning
					attempt_count as "attemptCount",
					window_started_at as "windowStartedAt"
				`,
				[sourceIpHash, now, resetBefore]
			)) as RawThrottleQueryResult
		);
		const row = rows[0];
		if (row === undefined) {
			throw new Error('Registration throttle query returned no rows');
		}

		return {
			attemptCount: requireNumber(
				row.attemptCount ?? row.attemptcount,
				'attemptCount'
			),
			windowStartedAt: requireDate(
				row.windowStartedAt ?? row.windowstartedat,
				'windowStartedAt'
			)
		};
	}

	async deleteStaleAttempts(before: Date, limit: number): Promise<number> {
		if (!Number.isFinite(limit) || limit <= 0) return 0;

		const rows = extractDeletedThrottleRows(
			(await this.dataSource.query(
				`
				with stale_attempts as (
					select source_ip_hash
					from community_scanner_registration_throttles
					where updated_at < $1
					order by updated_at asc
					limit $2
					for update skip locked
				)
				delete from community_scanner_registration_throttles
				using stale_attempts
				where community_scanner_registration_throttles.source_ip_hash =
					stale_attempts.source_ip_hash
				returning community_scanner_registration_throttles.source_ip_hash as "sourceIpHash"
				`,
				[before, Math.floor(limit)]
			)) as RawDeletedThrottleQueryResult
		);

		return rows.length;
	}
}

function extractThrottleRows(result: RawThrottleQueryResult): RawThrottleRow[] {
	if (Array.isArray(result)) {
		if (isStructuredThrottleQueryArray(result)) return result[0];

		return result;
	}

	if ('records' in result) return result.records;
	return result.raw;
}

function isStructuredThrottleQueryArray(
	result: RawThrottleQueryArray
): result is [RawThrottleRow[], number] {
	return Array.isArray(result[0]);
}

function extractDeletedThrottleRows(
	result: RawDeletedThrottleQueryResult
): RawDeletedThrottleRow[] {
	if (Array.isArray(result)) {
		if (isStructuredDeletedThrottleQueryArray(result)) return result[0];

		return result;
	}

	if ('records' in result) return result.records;
	return result.raw;
}

function isStructuredDeletedThrottleQueryArray(
	result: RawDeletedThrottleQueryArray
): result is [RawDeletedThrottleRow[], number] {
	return Array.isArray(result[0]);
}

function requireNumber(
	value: number | string | undefined,
	field: string
): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Registration throttle row is missing ${field}`);
	}

	return parsed;
}

function requireDate(value: Date | string | undefined, field: string): Date {
	if (value instanceof Date) return value;
	if (typeof value === 'string') {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}

	throw new Error(`Registration throttle row is missing ${field}`);
}
