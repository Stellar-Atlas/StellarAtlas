import { getHistoryArchiveUrlIdentity } from './ArchiveUrlIdentity.js';

type urlString = string;
//older or never before scanned urls go to the front
export function sortHistoryUrls(
	historyUrls: string[],
	scanDates: Map<urlString, Date>
): string[] {
	return historyUrls.sort((a: string, b: string): number => {
		const aScanDate = scanDates.get(getSortIdentity(a));
		const bScanDate = scanDates.get(getSortIdentity(b));

		if (!aScanDate) return -1;

		if (!bScanDate) return 1;

		return aScanDate.getTime() - bScanDate.getTime();
	});
}

function getSortIdentity(url: string): string {
	return getHistoryArchiveUrlIdentity(url) ?? url;
}
