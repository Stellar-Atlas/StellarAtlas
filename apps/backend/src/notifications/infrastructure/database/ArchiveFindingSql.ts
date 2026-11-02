import type { DataSource, QueryRunner } from 'typeorm';
import type {
	ArchiveFinding,
	ArchiveFindingSnapshot
} from '../../domain/subscription/ArchiveFindingState.js';

export async function queryRows(
	runner: QueryRunner,
	sql: string,
	parameters: unknown[] = []
): Promise<Record<string, unknown>[]> {
	const result: unknown = await runner.query(sql, parameters, true);
	if (
		typeof result !== 'object' ||
		result === null ||
		!('records' in result) ||
		!Array.isArray(result.records)
	)
		throw new Error('Invalid archive state query result');
	return result.records.map((row) => {
		if (typeof row !== 'object' || row === null || Array.isArray(row))
			throw new Error('Invalid archive state row');
		return row;
	});
}
export function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
		throw new Error('Invalid archive state identity');
	return value;
}
export function string(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Invalid archive state text');
	return value;
}
export function date(value: unknown): Date {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw new Error('Invalid archive state timestamp');
	return value;
}
export function snapshot(row: Record<string, unknown>): ArchiveFindingSnapshot {
	if (typeof row.observationConflicted !== 'boolean')
		throw new Error('Invalid archive conflict state');
	return {
		key: string(row.findingKey),
		observedAt: date(row.observedAt),
		observedFingerprint: string(row.observedFingerprint),
		conflicted: row.observationConflicted,
		deliveredFingerprint:
			row.deliveredFingerprint === null
				? null
				: string(row.deliveredFingerprint),
		deliveredObservationAt:
			row.deliveredObservationAt === null
				? null
				: date(row.deliveredObservationAt)
	};
}

export function currentFindings(
	findings: readonly ArchiveFinding[]
): { finding: ArchiveFinding; conflict: boolean }[] {
	const values = new Map<
		string,
		{ finding: ArchiveFinding; conflict: boolean }
	>();
	for (const finding of findings) {
		const previous = values.get(finding.key);
		if (!previous || finding.observedAt > previous.finding.observedAt)
			values.set(finding.key, { finding, conflict: false });
		else if (
			finding.observedAt.getTime() === previous.finding.observedAt.getTime() &&
			finding.fingerprint !== previous.finding.fingerprint
		)
			previous.conflict = true;
	}
	return [...values.values()].sort((left, right) =>
		left.finding.key.localeCompare(right.finding.key)
	);
}

export async function observeFindings(
	runner: QueryRunner,
	subscriptionId: number,
	current: ReturnType<typeof currentFindings>
): Promise<void> {
	await runner.query(
		`INSERT INTO "archive_integrity_notification_state"
		("subscriptionId", "findingKey", "observedFingerprint", "observedAt", "observationConflicted")
		SELECT $1, incoming.key, incoming.fingerprint, incoming.observed, incoming.conflict
		FROM unnest($2::text[], $3::text[], $4::timestamptz[], $5::boolean[]) AS incoming(key, fingerprint, observed, conflict)
		ON CONFLICT ("subscriptionId", "findingKey") DO UPDATE SET
		"observedFingerprint" = CASE WHEN EXCLUDED."observedAt" > "archive_integrity_notification_state"."observedAt" THEN EXCLUDED."observedFingerprint" ELSE "archive_integrity_notification_state"."observedFingerprint" END,
		"observationConflicted" = CASE WHEN EXCLUDED."observedAt" > "archive_integrity_notification_state"."observedAt" THEN EXCLUDED."observationConflicted"
			WHEN EXCLUDED."observedAt" = "archive_integrity_notification_state"."observedAt" THEN "archive_integrity_notification_state"."observationConflicted" OR EXCLUDED."observationConflicted" OR EXCLUDED."observedFingerprint" <> "archive_integrity_notification_state"."observedFingerprint"
			ELSE "archive_integrity_notification_state"."observationConflicted" END,
		"observedAt" = GREATEST(EXCLUDED."observedAt", "archive_integrity_notification_state"."observedAt")`,
		[
			subscriptionId,
			current.map((x) => x.finding.key),
			current.map((x) => x.finding.fingerprint),
			current.map((x) => x.finding.observedAt.toISOString()),
			current.map((x) => x.conflict)
		]
	);
}

export async function findingTransaction<T>(
	source: DataSource,
	work: (runner: QueryRunner) => Promise<T>
): Promise<T> {
	const runner = source.createQueryRunner();
	await runner.connect();
	try {
		await runner.startTransaction();
		const value = await work(runner);
		await runner.commitTransaction();
		return value;
	} catch (cause) {
		if (runner.isTransactionActive) await runner.rollbackTransaction();
		throw cause;
	} finally {
		await runner.release();
	}
}
