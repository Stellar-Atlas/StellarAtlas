import { Result, ok, err } from 'neverthrow';

export type ScanJobJSONInput = Readonly<Record<string, ScanJobJSONField>>;

type ScanJobJSONField = string | number | boolean | null | undefined;

/**
 * Represents a scan job.
 * A request to scan a specific URL starting from a specific ledger.
 */
export class ScanJobDTO {
	constructor(
		public readonly url: string,
		public readonly latestScannedLedger: number,
		public readonly latestScannedLedgerHeaderHash: string | null,
		public readonly chainInitDate: Date | null,
		public readonly remoteId: string,
		public readonly fromLedger: number | null = null,
		public readonly toLedger: number | null = null,
		public readonly concurrency: number | null = null
	) {}

	static fromJSON(json: ScanJobJSONInput): Result<ScanJobDTO, Error> {
		if (!this.isValidScanJobJSON(json)) {
			return err(new Error('Invalid ScanJobDTO JSON format'));
		}

		return ok(
			new ScanJobDTO(
				json.url,
				json.latestScannedLedger,
				json.latestScannedLedgerHeaderHash,
				json.chainInitDate ? new Date(json.chainInitDate) : null,
				json.remoteId,
				this.getOptionalInteger(json.fromLedger),
				this.getOptionalInteger(json.toLedger),
				this.getOptionalInteger(json.concurrency)
			)
		);
	}

	private static isValidScanJobJSON(
		json: ScanJobJSONInput
	): json is ScanJobJSON {
		return (
			typeof json === 'object' &&
			json !== null &&
			typeof json.url === 'string' &&
			typeof json.latestScannedLedger === 'number' &&
			Number.isInteger(json.latestScannedLedger) &&
			(json.latestScannedLedgerHeaderHash === null ||
				typeof json.latestScannedLedgerHeaderHash === 'string') &&
			(json.chainInitDate === null ||
				(typeof json.chainInitDate === 'string' &&
					!isNaN(new Date(json.chainInitDate).getTime()))) &&
			typeof json.remoteId === 'string' &&
			this.isOptionalInteger(json.fromLedger) &&
			this.isOptionalInteger(json.toLedger) &&
			this.isOptionalInteger(json.concurrency)
		);
	}

	private static isOptionalInteger(value: ScanJobJSONField): boolean {
		return (
			value === undefined ||
			value === null ||
			(typeof value === 'number' && Number.isInteger(value))
		);
	}

	private static getOptionalInteger(value: ScanJobJSONField): number | null {
		if (typeof value === 'number' && Number.isInteger(value)) return value;

		return null;
	}
}

interface ScanJobJSON extends ScanJobJSONInput {
	url: string;
	latestScannedLedger: number;
	latestScannedLedgerHeaderHash: string | null;
	chainInitDate: string | null;
	remoteId: string;
	fromLedger?: number | null;
	toLedger?: number | null;
	concurrency?: number | null;
}
