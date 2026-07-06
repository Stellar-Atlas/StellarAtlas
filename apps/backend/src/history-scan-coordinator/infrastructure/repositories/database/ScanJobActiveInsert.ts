import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import type { EntityManager, Repository } from 'typeorm';

const activeInsertLockName = 'history_archive_scan_job_active_identity_insert';

type InsertedScanJobRow = {
	readonly id?: number | string;
	readonly createdAt?: Date | string;
	readonly createdat?: Date | string;
	readonly updatedAt?: Date | string;
	readonly updatedat?: Date | string;
};

type InsertQueryResult =
	| InsertedScanJobRow[]
	| [InsertedScanJobRow[], number]
	| { raw: InsertedScanJobRow[] }
	| { records: InsertedScanJobRow[] };
type InsertQueryArray = InsertedScanJobRow[] | [InsertedScanJobRow[], number];

export async function saveScanJobsWithActiveIdentityGuard(
	repository: Repository<ScanJob>,
	scanJobs: readonly ScanJob[]
): Promise<number> {
	const existingJobs = scanJobs.filter(hasPersistedId);
	const newJobs = scanJobs.filter((job) => !hasPersistedId(job));
	const inactiveNewJobs = newJobs.filter((job) => !isActive(job));
	const activeNewJobs = newJobs.filter(isActive);
	let savedCount = 0;

	if (existingJobs.length > 0) {
		await repository.save(existingJobs);
		savedCount += existingJobs.length;
	}
	if (inactiveNewJobs.length > 0) {
		await repository.save(inactiveNewJobs);
		savedCount += inactiveNewJobs.length;
	}
	if (activeNewJobs.length === 0) return savedCount;

	const insertedCount = await repository.manager.transaction(
		async (manager) => {
			await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
				activeInsertLockName
			]);

			let activeInsertedCount = 0;
			for (const job of activeNewJobs) {
				if (await insertActiveJobIfIdentityIsNew(manager, job)) {
					activeInsertedCount += 1;
				}
			}

			return activeInsertedCount;
		}
	);

	return savedCount + insertedCount;
}

async function insertActiveJobIfIdentityIsNew(
	manager: EntityManager,
	job: ScanJob
): Promise<boolean> {
	const rows = extractRows(
		(await manager.query(
			`
			insert into history_archive_scan_job_queue (
				"remoteId",
				url,
				"latestScannedLedger",
				"latestScannedLedgerHeaderHash",
				"chainInitDate",
				"fromLedger",
				"toLedger",
				concurrency,
				"latestAttemptedLedger",
				"currentRangeFromLedger",
				"currentRangeToLedger",
				"claimedByCommunityScannerId",
				"claimedAt",
				status
			)
			select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
			where not exists (
				select 1
				from history_archive_scan_job_queue existing
				where existing.status in ('PENDING', 'TAKEN')
					and lower(regexp_replace(existing.url, '/+$', '')) = $15
					and existing."fromLedger" is not distinct from $6
					and existing."toLedger" is not distinct from $7
			)
			returning
				id as "id",
				"createdAt" as "createdAt",
				"updatedAt" as "updatedAt"
			`,
			[
				job.remoteId,
				job.url,
				job.latestScannedLedger,
				job.latestScannedLedgerHeaderHash,
				job.chainInitDate,
				job.fromLedger,
				job.toLedger,
				job.concurrency,
				job.latestAttemptedLedger,
				job.currentRangeFromLedger,
				job.currentRangeToLedger,
				job.claimedByCommunityScannerId,
				job.claimedAt,
				job.status,
				normalizeScanJobUrl(job.url)
			]
		)) as InsertQueryResult
	);
	const row = rows[0];
	if (row === undefined) return false;

	const id = Number(row.id);
	if (Number.isSafeInteger(id)) job.id = id;
	job.createdAt = toDate(row.createdAt ?? row.createdat);
	job.updatedAt = toDate(row.updatedAt ?? row.updatedat);
	return true;
}

function hasPersistedId(job: ScanJob): boolean {
	return Number.isSafeInteger(job.id);
}

function isActive(job: ScanJob): boolean {
	return job.status === 'PENDING' || job.status === 'TAKEN';
}

function normalizeScanJobUrl(url: string): string {
	return getHistoryArchiveUrlIdentity(url) ?? url.trim().toLowerCase();
}

function extractRows(result: InsertQueryResult): InsertedScanJobRow[] {
	if (Array.isArray(result)) {
		if (isStructuredQueryArray(result)) return result[0];

		return result as InsertedScanJobRow[];
	}

	if ('records' in result) return result.records;

	return result.raw;
}

function isStructuredQueryArray(
	result: InsertQueryArray
): result is [InsertedScanJobRow[], number] {
	return Array.isArray(result[0]) && typeof result[1] === 'number';
}

function toDate(value: Date | string | undefined): Date | undefined {
	if (value === undefined) return undefined;
	if (value instanceof Date) return value;

	return new Date(value);
}
