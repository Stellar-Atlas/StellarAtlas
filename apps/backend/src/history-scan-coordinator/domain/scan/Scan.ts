import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { Url } from '@core/domain/Url.js';
import { ScanError, ScanErrorType } from './ScanError.js';
import { CoreEntity } from '@core/domain/CoreEntity.js';
import {
	mapDetailsToScanError,
	mapScanErrorToDetails,
	type ScanErrorDetails
} from './ScanErrorDetails.js';
import type { ScanEvidenceDTO } from 'history-scanner-dto';

/**
 * Used to represent a chain of scans for a history url.
 * By grouping the initDate and the url, you get all the scans in a chain. A new initDate starts a new chain for the url.
 * Start and end dates are the times the scan was started and ended for this part of the chain.
 */
@Entity({ name: 'history_archive_scan_v2' })
export class Scan extends CoreEntity {
	//date where scan for the url was started
	@Column('timestamptz', { name: 'initializeDate' })
	public readonly scanChainInitDate: Date;

	@Index()
	@Column('timestamptz')
	public readonly startDate: Date;

	@Column('timestamptz', { nullable: false })
	public readonly endDate: Date;

	public baseUrl: Url;

	@Column('integer', { nullable: false })
	public readonly fromLedger: number = 0;

	@Column('integer', { nullable: true })
	public readonly toLedger: number | null = null;

	@Column('integer', { nullable: false })
	public readonly latestScannedLedger: number = 0;

	@Column('text', { nullable: true })
	public readonly latestScannedLedgerHeaderHash: string | null = null;

	@Column('smallint')
	public readonly concurrency: number = 0;

	@Column('boolean', { nullable: true })
	public readonly isSlowArchive: boolean | null = null;

	@Index()
	@Column('uuid', { nullable: true })
	public readonly communityScannerId: string | null = null;

	@Index()
	@Column('text', { nullable: true })
	public readonly scanJobRemoteId: string | null = null;

	@OneToOne(() => ScanError, { nullable: true, cascade: true, eager: true })
	@JoinColumn()
	public readonly error: ScanError | null = null;

	@Column('jsonb', { nullable: false, default: () => "'[]'::jsonb" })
	public readonly errors: readonly ScanErrorDetails[] = [];

	public readonly evidence: readonly ScanEvidenceDTO[] = [];

	constructor(
		scanChainInitDate: Date,
		startDate: Date,
		endDate: Date,
		url: Url,
		fromLedger: number,
		toLedger: number | null,
		latestScannedLedger = 0,
		latestScannedLedgerHeaderHash: string | null = null,
		concurrency = 0,
		archiveIsSlow: boolean | null = null,
		error: ScanError | null = null,
		errors: readonly ScanError[] = [],
		communityScannerId: string | null = null,
		scanJobRemoteId: string | null = null,
		evidence: readonly ScanEvidenceDTO[] = []
	) {
		super();
		const scanErrors = errors.length > 0 ? errors : error ? [error] : [];
		this.baseUrl = url;
		this.scanChainInitDate = scanChainInitDate;
		this.concurrency = concurrency;
		this.startDate = startDate;
		this.endDate = endDate;
		this.isSlowArchive = archiveIsSlow;
		this.fromLedger = fromLedger;
		this.toLedger = toLedger;
		this.error = error ?? scanErrors[0] ?? null;
		this.errors = scanErrors.map(mapScanErrorToDetails);
		this.evidence = evidence;
		this.latestScannedLedger = latestScannedLedger;
		this.latestScannedLedgerHeaderHash = latestScannedLedgerHeaderHash;
		this.communityScannerId = communityScannerId;
		this.scanJobRemoteId = scanJobRemoteId;
	}

	@Index()
	@Column('text')
	private get url(): string {
		return this.baseUrl.value;
	}

	private set url(value: string) {
		const baseUrlResult = Url.create(value);
		if (baseUrlResult.isErr()) throw baseUrlResult.error;

		this.baseUrl = baseUrlResult.value;
	}

	hasError(): boolean {
		return this.error !== null || this.errors.length > 0;
	}

	hasArchiveVerificationError(): boolean {
		return this.scanErrors.some(
			(error) => error.type === ScanErrorType.TYPE_VERIFICATION
		);
	}

	hasWorkerIssue(): boolean {
		return this.scanErrors.some(
			(error) => error.type === ScanErrorType.TYPE_CONNECTION
		);
	}

	get scanErrors(): readonly ScanError[] {
		const mappedErrors = this.errors
			.map(mapDetailsToScanError)
			.filter((error): error is ScanError => error !== null);

		return mappedErrors.length > 0
			? mappedErrors
			: this.error
				? [this.error]
				: [];
	}

	public isStartOfScanChain() {
		return this.scanChainInitDate.getTime() === this.startDate.getTime();
	}

	/*
	Last ledger hash is not yet checked with trusted source,
	so we return the previous one that is surely verified through the previous header hash value
	because we verify ledgers in ascending order
	 */
	get latestVerifiedLedger() {
		if (this.latestScannedLedger === 0) return 0;

		return this.latestScannedLedger - 1;
	}
}
