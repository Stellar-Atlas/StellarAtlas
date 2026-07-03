import NetworkScan from './NetworkScan.js';

export interface NetworkScanSummary {
	readonly totalScans: number;
	readonly completedScans: number;
	readonly latestScanAt: Date | null;
	readonly latestCompletedScanAt: Date | null;
}

export interface NetworkScanRepository {
	findLatestSuccessfulScanTime(): Promise<Date | undefined>;

	findScanSummary(from: Date, to: Date): Promise<NetworkScanSummary>;

	findLatest(): Promise<NetworkScan | undefined>;

	findAt(at: Date): Promise<NetworkScan | undefined>;

	findPreviousAt(at: Date): Promise<NetworkScan | undefined>;

	saveOne(scan: NetworkScan): Promise<NetworkScan>;

	save(scans: NetworkScan[]): Promise<NetworkScan[]>;
}
