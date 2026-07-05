import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Repository } from 'typeorm';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { injectable } from 'inversify';
import { ScanEvidence } from '@history-scan-coordinator/domain/scan/ScanEvidence.js';

type NumericValue = number | string;
type RawLatestScanIdRow = { id?: NumericValue };
type ScanWithId = Scan & { id: number };
type LatestScanQueryOptions = {
	readonly limit?: number;
	readonly url?: string;
};

@injectable()
export class TypeOrmHistoryArchiveScanResultRepository implements ScanRepository {
	constructor(private baseRepository: Repository<Scan>) {}

	async save(scans: Scan[]): Promise<Scan[]> {
		const savedScans = await this.baseRepository.save(scans);
		await this.saveEvidence(savedScans, scans);
		return savedScans;
	}

	async findLatestByUrl(url: string): Promise<Scan | null> {
		const [scanId] = await this.findSelectedScanIds({ url });
		if (scanId === undefined) return null;

		return await this.findById(scanId);
	}

	async findRecentByUrl(url: string, limit: number): Promise<Scan[]> {
		return await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.url=:url', { url })
			.leftJoinAndSelect('scan.error', 'error')
			.orderBy('scan.startDate', 'DESC')
			.take(limit)
			.getMany();
	}

	async findEvidenceByUrl(url: string, limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1) {
			return { count: 0, evidence: [] };
		}

		const evidenceRepository =
			this.baseRepository.manager.getRepository(ScanEvidence);
		const [evidence, count] = await evidenceRepository.findAndCount({
			where: { archiveUrl: url },
			order: { observedAt: 'DESC', bucketHash: 'ASC' },
			take: limit
		});

		return { count, evidence };
	}

	async findLatestLimited(limit: number): Promise<Scan[]> {
		if (!Number.isSafeInteger(limit) || limit < 1) return [];

		const scanIds = await this.findSelectedScanIds({ limit });
		if (scanIds.length === 0) return [];

		return this.findByIds(scanIds);
	}

	async findRecentLimited(limit: number): Promise<Scan[]> {
		if (!Number.isSafeInteger(limit) || limit < 1) return [];

		return await this.baseRepository
			.createQueryBuilder('scan')
			.leftJoinAndSelect('scan.error', 'error')
			.orderBy('scan.startDate', 'DESC')
			.addOrderBy('scan.id', 'DESC')
			.take(limit)
			.getMany();
	}

	async findLatest(): Promise<Scan[]> {
		const scanIds = await this.findSelectedScanIds({});
		if (scanIds.length === 0) return [];

		return this.findByIds(scanIds);
	}

	private async findById(scanId: number): Promise<Scan> {
		const scan = await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.id = :scanId', { scanId })
			.leftJoinAndSelect('scan.error', 'error')
			.getOne();
		if (scan === null) {
			throw new Error('Latest history archive scan row was not found');
		}

		return scan;
	}

	private async saveEvidence(
		savedScans: readonly Scan[],
		inputScans: readonly Scan[]
	): Promise<void> {
		const evidenceRows = savedScans.flatMap((savedScan, index) => {
			const inputScan = inputScans[index];
			if (inputScan === undefined || inputScan.evidence.length === 0) {
				return [];
			}

			return Array.from(dedupeEvidence(inputScan.evidence).values()).map(
				(evidence) =>
					new ScanEvidence(
						(savedScan as ScanWithId).id,
						inputScan.baseUrl.value,
						inputScan.scanJobRemoteId ?? '',
						inputScan.endDate,
						evidence
					)
			);
		});

		if (evidenceRows.length === 0) return;

		await this.baseRepository.manager
			.createQueryBuilder()
			.insert()
			.into(ScanEvidence)
			.values(evidenceRows)
			.orIgnore()
			.execute();
	}

	private async findByIds(scanIds: readonly number[]): Promise<Scan[]> {
		if (scanIds.length === 0) return [];

		const scans = await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.id in (:...scanIds)', { scanIds })
			.leftJoinAndSelect('scan.error', 'error')
			.getMany();
		const scansById = new Map(
			scans.map((scan) => [(scan as ScanWithId).id, scan])
		);

		return scanIds.map((id) => {
			const scan = scansById.get(id);
			if (scan === undefined) {
				throw new Error('Latest history archive scan row was not found');
			}

			return scan;
		});
	}

	private async findSelectedScanIds(
		options: LatestScanQueryOptions
	): Promise<number[]> {
		const params: (number | string)[] = [];
		const urlFilter =
			options.url === undefined
				? ''
				: `where scan.url = $${params.push(options.url)}`;
		const limitClause =
			options.limit === undefined ? '' : `limit $${params.push(options.limit)}`;
		const rows = (await this.baseRepository.query(
			`
				with scan_with_error_flags as (
					select
						scan.id,
						scan.url,
						scan."startDate",
						scan.concurrency,
						(
							exists (
								select 1
								from jsonb_array_elements(coalesce(scan.errors, '[]'::jsonb)) error
								where error->>'type' = 'TYPE_VERIFICATION'
							)
							or archive_error.type::text in ('0', 'TYPE_VERIFICATION')
						) as "hasArchiveVerificationError",
						(
							exists (
								select 1
								from jsonb_array_elements(coalesce(scan.errors, '[]'::jsonb)) error
								where error->>'type' = 'TYPE_CONNECTION'
							)
							or archive_error.type::text in ('1', 'TYPE_CONNECTION')
						) as "hasWorkerIssue"
					from history_archive_scan_v2 scan
					left join history_archive_scan_error archive_error
						on archive_error.id = scan."errorId"
					${urlFilter}
				),
				latest_scan as (
					select distinct on (url)
						id,
						url,
						"startDate"
					from scan_with_error_flags
					order by url, "startDate" desc, id desc
				),
				latest_archive_evidence_scan as (
					select distinct on (url)
						id,
						url,
						"startDate"
					from scan_with_error_flags
					where
						"hasArchiveVerificationError"
						or (
							concurrency > 0
							and not "hasWorkerIssue"
						)
					order by url, "startDate" desc, id desc
				),
				selected_scan as (
					select
						coalesce(latest_archive_evidence_scan.id, latest_scan.id) as id,
						coalesce(
							latest_archive_evidence_scan."startDate",
							latest_scan."startDate"
						) as "selectedStartDate"
					from latest_scan
					left join latest_archive_evidence_scan
						on latest_archive_evidence_scan.url = latest_scan.url
				)
				select id
				from selected_scan
				order by "selectedStartDate" desc, id desc
				${limitClause}
			`,
			params
		)) as RawLatestScanIdRow[];

		return rows.map((row) => this.requireNumber(row.id, 'id'));
	}

	private requireNumber(
		value: NumericValue | undefined,
		field: string
	): number {
		if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
		if (typeof value === 'string' && /^\d+$/.test(value)) {
			const parsed = Number(value);
			if (Number.isSafeInteger(parsed)) return parsed;
		}

		throw new Error(
			`History archive scan row is missing numeric field ${field}`
		);
	}
}

function dedupeEvidence<T extends { readonly bucketHash: string }>(
	evidence: readonly T[]
): Map<string, T> {
	return new Map(evidence.map((entry) => [entry.bucketHash, entry]));
}
