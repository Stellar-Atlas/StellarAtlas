import { injectable } from 'inversify';
import type {
	ArchiveScanQueueStats,
	ScanJobRepository
} from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { EntityManager, MoreThan, Repository } from 'typeorm';

type NumericValue = number | string;

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
	status: 'PENDING' | 'TAKEN' | 'DONE';
	createdAt: Date;
	updatedAt: Date;
};

type RawScanJobRow = Partial<ScanJobRow> & {
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
	createdat?: Date | string;
	updatedat?: Date | string;
};

type RawQueueStatsRow = {
	pendingJobs?: NumericValue;
	pendingjobs?: NumericValue;
	activeJobs?: NumericValue;
	activejobs?: NumericValue;
	staleJobs?: NumericValue;
	stalejobs?: NumericValue;
	totalUnfinishedJobs?: NumericValue;
	totalunfinishedjobs?: NumericValue;
};

type RawQueryResult =
	| RawScanJobRow[]
	| [RawScanJobRow[], number]
	| { raw: RawScanJobRow[] }
	| { records: RawScanJobRow[] };

type RawQueryArray = RawScanJobRow[] | [RawScanJobRow[], number];

@injectable()
export class TypeOrmScanJobRepository implements ScanJobRepository {
	constructor(private baseRepository: Repository<ScanJob>) {}

	async save(scanJobs: ScanJob[]): Promise<void> {
		await this.baseRepository.save(scanJobs);
	}

	async fetchNextJob(): Promise<ScanJob | null> {
		return await this.baseRepository.manager.transaction(async (manager) => {
			const rows = await this.claimNextPendingJob(manager);
			const row = rows[0];
			if (row === undefined) return null;

			return this.createScanJobFromRow(row);
		});
	}

	async findActiveByUrl(url: string, limit: number): Promise<ScanJob[]> {
		return this.baseRepository
			.createQueryBuilder('job')
			.where('job.url = :url', { url })
			.andWhere('job.status in (:...statuses)', {
				statuses: ['TAKEN', 'PENDING']
			})
			.orderBy("case when job.status = 'TAKEN' then 0 else 1 end", 'ASC')
			.addOrderBy('job.updatedAt', 'DESC')
			.addOrderBy('job.createdAt', 'DESC')
			.limit(limit)
			.getMany();
	}

	private createScanJobFromRow(row: RawScanJobRow): ScanJob {
		const scanJobRow = this.normalizeScanJobRow(row);
		const scanJob = new ScanJob(
			scanJobRow.url,
			scanJobRow.latestScannedLedger,
			scanJobRow.latestScannedLedgerHeaderHash,
			scanJobRow.chainInitDate,
			scanJobRow.fromLedger,
			scanJobRow.toLedger,
			scanJobRow.concurrency,
			scanJobRow.remoteId
		);
		scanJob.id = scanJobRow.id;
		scanJob.status = scanJobRow.status;
		scanJob.createdAt = scanJobRow.createdAt;
		scanJob.updatedAt = scanJobRow.updatedAt;
		return scanJob;
	}

	private normalizeScanJobRow(row: RawScanJobRow): ScanJobRow {
		return {
			id: this.requireNumber(row.id, 'id'),
			remoteId: this.requireString(row.remoteId ?? row.remoteid, 'remoteId'),
			url: this.requireString(row.url, 'url'),
			latestScannedLedger: this.requireNumber(
				row.latestScannedLedger ?? row.latestscannedledger,
				'latestScannedLedger'
			),
			latestScannedLedgerHeaderHash:
				row.latestScannedLedgerHeaderHash ??
				row.latestscannedledgerheaderhash ??
				null,
			chainInitDate: this.toNullableDate(
				row.chainInitDate === undefined ? row.chaininitdate : row.chainInitDate
			),
			fromLedger: this.toNullableNumber(
				row.fromLedger === undefined ? row.fromledger : row.fromLedger
			),
			toLedger: this.toNullableNumber(
				row.toLedger === undefined ? row.toledger : row.toLedger
			),
			concurrency: this.toNullableNumber(row.concurrency),
			status: this.requireStatus(row.status),
			createdAt: this.requireDate(row.createdAt ?? row.createdat, 'createdAt'),
			updatedAt: this.requireDate(row.updatedAt ?? row.updatedat, 'updatedAt')
		};
	}

	private requireNumber(
		value: NumericValue | undefined,
		field: string
	): number {
		const numberValue = this.parseNumber(value);
		if (numberValue === null) {
			throw new Error(`Scan job row is missing numeric field ${field}`);
		}

		return numberValue;
	}

	private requireString(value: string | undefined, field: string): string {
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Scan job row is missing string field ${field}`);
		}

		return value;
	}

	private requireStatus(
		value: string | undefined
	): 'PENDING' | 'TAKEN' | 'DONE' {
		if (value === 'PENDING' || value === 'TAKEN' || value === 'DONE') {
			return value;
		}

		throw new Error('Scan job row is missing status');
	}

	private requireDate(value: Date | string | undefined, field: string): Date {
		const date = this.toNullableDate(value);
		if (date === null || Number.isNaN(date.getTime())) {
			throw new Error(`Scan job row is missing date field ${field}`);
		}

		return date;
	}

	private toNullableDate(value: Date | string | null | undefined): Date | null {
		if (value === null || value === undefined) return null;
		if (value instanceof Date) return value;

		return new Date(value);
	}

	private toNullableNumber(
		value: NumericValue | null | undefined
	): number | null {
		if (value === null || value === undefined) return null;

		return this.parseNumber(value);
	}

	private parseNumber(value: NumericValue | undefined): number | null {
		if (typeof value === 'number') {
			return Number.isSafeInteger(value) ? value : null;
		}

		if (typeof value === 'string' && /^\d+$/.test(value)) {
			const parsed = Number(value);
			return Number.isSafeInteger(parsed) ? parsed : null;
		}

		return null;
	}

	private extractQueryRows(result: RawQueryResult): RawScanJobRow[] {
		if (Array.isArray(result)) {
			if (this.isStructuredQueryArray(result)) {
				return result[0];
			}

			return result;
		}

		if ('records' in result) return result.records;

		return result.raw;
	}

	private isStructuredQueryArray(
		result: RawQueryArray
	): result is [RawScanJobRow[], number] {
		return Array.isArray(result[0]) && typeof result[1] === 'number';
	}

	private async claimNextPendingJob(
		manager: EntityManager
	): Promise<RawScanJobRow[]> {
		const result = (await manager.query(`
			update history_archive_scan_job_queue
			set status = 'TAKEN',
				"updatedAt" = now()
			where id = (
				select id
				from history_archive_scan_job_queue
				where status = 'PENDING'
				order by
					case when "fromLedger" is null then 1 else 0 end asc,
					id asc
				for update skip locked
				limit 1
			)
			returning
				id as "id",
				"remoteId" as "remoteId",
				url as "url",
				"latestScannedLedger" as "latestScannedLedger",
				"latestScannedLedgerHeaderHash" as "latestScannedLedgerHeaderHash",
				"chainInitDate" as "chainInitDate",
				"fromLedger" as "fromLedger",
				"toLedger" as "toLedger",
				concurrency as "concurrency",
				status as "status",
				"createdAt" as "createdAt",
				"updatedAt" as "updatedAt"
		`)) as RawQueryResult;

		return this.extractQueryRows(result);
	}

	async hasPendingJobs(): Promise<boolean> {
		return (
			(await this.baseRepository.count({ where: { status: 'PENDING' } })) > 0
		);
	}

	findByRemoteId(remoteId: string): Promise<ScanJob | null> {
		return this.baseRepository.findOne({ where: { remoteId } });
	}

	findUnfinishedJobs(afterUpdatedAt: Date): Promise<ScanJob[]> {
		return this.baseRepository.find({
			where: [
				{ status: 'TAKEN', updatedAt: MoreThan(afterUpdatedAt) },
				{ status: 'PENDING', updatedAt: MoreThan(afterUpdatedAt) }
			]
		});
	}

	async getQueueStats(staleTakenBefore: Date): Promise<ArchiveScanQueueStats> {
		const row = await this.baseRepository
			.createQueryBuilder('job')
			.select("count(*) filter (where job.status = 'PENDING')", 'pendingJobs')
			.addSelect(
				`count(*) filter (
					where job.status = 'TAKEN'
					and job."updatedAt" >= :staleTakenBefore
				)`,
				'activeJobs'
			)
			.addSelect(
				`count(*) filter (
					where job.status = 'TAKEN'
					and job."updatedAt" < :staleTakenBefore
				)`,
				'staleJobs'
			)
			.addSelect(
				"count(*) filter (where job.status in ('PENDING', 'TAKEN'))",
				'totalUnfinishedJobs'
			)
			.setParameter('staleTakenBefore', staleTakenBefore)
			.getRawOne<RawQueueStatsRow>();

		return {
			pendingJobs: this.requireNumber(
				row?.pendingJobs ?? row?.pendingjobs,
				'pendingJobs'
			),
			activeJobs: this.requireNumber(
				row?.activeJobs ?? row?.activejobs,
				'activeJobs'
			),
			staleJobs: this.requireNumber(
				row?.staleJobs ?? row?.stalejobs,
				'staleJobs'
			),
			totalUnfinishedJobs: this.requireNumber(
				row?.totalUnfinishedJobs ?? row?.totalunfinishedjobs,
				'totalUnfinishedJobs'
			)
		};
	}

	async markTakenJobActive(remoteId: string): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({ updatedAt: () => 'now()' })
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'TAKEN' })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async releaseStaleTakenJobs(before: Date): Promise<number> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({ status: 'PENDING' })
			.where('status = :status', { status: 'TAKEN' })
			.andWhere('"updatedAt" < :before', { before })
			.execute();

		return result.affected ?? 0;
	}
}
