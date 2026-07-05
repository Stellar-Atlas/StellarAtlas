import { Result, ok, err } from 'neverthrow';
import { isScanErrorTypeDTO, type ScanErrorDTO } from './ScanErrorDTO.js';
import { isScanEvidenceDTO, type ScanEvidenceDTO } from './ScanEvidenceDTO.js';
import {
	isArchiveMetadataDTO,
	type ArchiveMetadataDTO
} from './ArchiveMetadataDTO.js';

/**
 * Represents a finished scan.
 */
export class ScanDTO {
	constructor(
		public readonly startDate: Date,
		public readonly endDate: Date,
		public readonly baseUrl: string,
		public readonly scanChainInitDate: Date,
		public readonly fromLedger: number,
		public readonly toLedger: number | null,
		public readonly latestVerifiedLedger: number,
		public readonly latestScannedLedger: number,
		public readonly latestScannedLedgerHeaderHash: string | null,
		public readonly concurrency: number,
		public readonly isSlowArchive: boolean | null,
		public readonly error: ScanErrorDTO | null,
		public readonly scanJobRemoteId: string,
		public readonly errors: readonly ScanErrorDTO[] = [],
		public readonly evidence?: readonly ScanEvidenceDTO[],
		public readonly archiveMetadata?: ArchiveMetadataDTO
	) {}

	static fromJSON(json: Record<string, unknown>): Result<ScanDTO, Error> {
		if (!this.isValidScanJSON(json)) {
			return err(new Error('Invalid ScanDTO JSON format'));
		}

		return ok(
			new ScanDTO(
				new Date(json.startDate as string),
				new Date(json.endDate as string),
				json.baseUrl as string,
				new Date(json.scanChainInitDate as string),
				json.fromLedger as number,
				json.toLedger as number | null,
				json.latestVerifiedLedger as number,
				json.latestScannedLedger as number,
				json.latestScannedLedgerHeaderHash as string | null,
				json.concurrency as number,
				json.isSlowArchive as boolean | null,
				json.error as ScanErrorDTO | null,
				json.scanJobRemoteId as string,
				this.mapErrors(json),
				this.mapEvidence(json),
				this.mapArchiveMetadata(json)
			)
		);
	}

	private static isValidScanJSON(json: Record<string, unknown>): boolean {
		return (
			typeof json === 'object' &&
			json !== null &&
			typeof json.startDate === 'string' &&
			!isNaN(new Date(json.startDate).getTime()) &&
			typeof json.endDate === 'string' &&
			!isNaN(new Date(json.endDate).getTime()) &&
			typeof json.baseUrl === 'string' &&
			typeof json.scanChainInitDate === 'string' &&
			!isNaN(new Date(json.scanChainInitDate).getTime()) &&
			typeof json.fromLedger === 'number' &&
			Number.isInteger(json.fromLedger) &&
			(json.toLedger === null || Number.isInteger(json.toLedger)) &&
			typeof json.latestVerifiedLedger === 'number' &&
			Number.isInteger(json.latestVerifiedLedger) &&
			typeof json.latestScannedLedger === 'number' &&
			Number.isInteger(json.latestScannedLedger) &&
			(json.latestScannedLedgerHeaderHash === null ||
				typeof json.latestScannedLedgerHeaderHash === 'string') &&
			typeof json.concurrency === 'number' &&
			Number.isInteger(json.concurrency) &&
			(json.isSlowArchive === null ||
				typeof json.isSlowArchive === 'boolean') &&
			(json.error === null || this.isValidScanErrorDTO(json.error)) &&
			(json.errors === undefined ||
				(Array.isArray(json.errors) &&
					json.errors.every((error) => this.isValidScanErrorDTO(error)))) &&
			(json.evidence === undefined ||
				(Array.isArray(json.evidence) &&
					json.evidence.every((evidence) => isScanEvidenceDTO(evidence)))) &&
			(json.archiveMetadata === undefined ||
				isArchiveMetadataDTO(json.archiveMetadata)) &&
			typeof json.scanJobRemoteId === 'string'
		);
	}

	private static mapErrors(json: Record<string, unknown>): ScanErrorDTO[] {
		if (Array.isArray(json.errors)) return json.errors as ScanErrorDTO[];

		return json.error === null ? [] : [json.error as ScanErrorDTO];
	}

	private static mapEvidence(
		json: Record<string, unknown>
	): ScanEvidenceDTO[] | undefined {
		if (!Array.isArray(json.evidence)) return undefined;

		return json.evidence as ScanEvidenceDTO[];
	}

	private static mapArchiveMetadata(
		json: Record<string, unknown>
	): ArchiveMetadataDTO | undefined {
		if (json.archiveMetadata === undefined) return undefined;
		if (!isArchiveMetadataDTO(json.archiveMetadata)) return undefined;

		return json.archiveMetadata;
	}

	private static isValidScanErrorDTO(error: unknown): error is ScanErrorDTO {
		if (typeof error !== 'object' || error === null) return false;

		const candidate = error as Record<string, unknown>;
		return (
			isScanErrorTypeDTO(candidate.type) &&
			typeof candidate.url === 'string' &&
			typeof candidate.message === 'string'
		);
	}
}
