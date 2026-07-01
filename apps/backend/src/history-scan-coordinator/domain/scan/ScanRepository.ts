import { Scan } from './Scan.js';

export interface ScanRepository {
	save(scans: Scan[]): Promise<Scan[]>;
	findLatestByUrl(url: string): Promise<Scan | null>;
	findLatest(): Promise<Scan[]>;
}
