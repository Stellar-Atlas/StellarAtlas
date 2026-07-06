import { Scan } from './Scan.js';
import { ScanEvidence } from './ScanEvidence.js';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';

export interface ScanEvidencePage {
	readonly count: number;
	readonly evidence: readonly ScanEvidence[];
}

export interface ScanRepository {
	save(scans: Scan[]): Promise<Scan[]>;
	findLatestByUrl(url: string): Promise<Scan | null>;
	findRecentByUrl(url: string, limit: number): Promise<Scan[]>;
	findEvidenceByUrl(url: string, limit: number): Promise<ScanEvidencePage>;
	findLatestLimited(limit: number): Promise<Scan[]>;
	findRecentLimited(limit: number): Promise<Scan[]>;
	findLatest(): Promise<Scan[]>;
	findUrlsMissingSelectedArchiveMetadata(limit: number): Promise<string[]>;
	findDiscoveredUrlsMissingArchiveState(limit: number): Promise<string[]>;
	backfillSelectedArchiveMetadata(
		url: string,
		archiveMetadata: ArchiveMetadataDTO
	): Promise<boolean>;
}
