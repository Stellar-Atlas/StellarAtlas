import { recordValue, type EntityRecord } from './explorer-analytics';
import { validReportCursor } from '../components/blockchain/asset-report-route';

export interface AssetReportPage {
	readonly rows: readonly EntityRecord[];
	readonly next: string | null;
	readonly complete: boolean;
}
export function parseAssetReportPage(value: unknown, asset: string): AssetReportPage {
	const page = recordValue(value);
	if (page.asset !== asset || page.limit !== 25 || !Array.isArray(page.data) || page.data.length > 25 ||
		page.data.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row)) ||
		(page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !validReportCursor(page.nextCursor))) ||
		!['complete', 'partial_or_unknown'].includes(String(page.coverageStatus)) || page.amountPrecision !== 'source-float64')
		throw new Error('Invalid asset report page returned by the data service.');
	return {rows: page.data.map(recordValue), next: page.nextCursor as string | null, complete: page.coverageStatus === 'complete'};
}
