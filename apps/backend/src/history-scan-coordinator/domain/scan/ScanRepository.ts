import { Scan } from './Scan.js';

export interface ScanRepository {
	save(scans: Scan[]): Promise<Scan[]>;
	findLatestByUrl(url: string): Promise<Scan | null>;
	findRecentByUrl(url: string, limit: number): Promise<Scan[]>;
	findLatestLimited(limit: number): Promise<Scan[]>;
	findRecentLimited(limit: number): Promise<Scan[]>;
	findLatest(): Promise<Scan[]>;
}
