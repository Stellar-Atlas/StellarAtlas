const archiveScanRouteBase = '/archive-scans';

export function getArchiveScanDetailPath(historyUrl: string): string {
	return `${archiveScanRouteBase}/${encodeURIComponent(historyUrl)}`;
}

export function decodeArchiveScanRouteParam(
	encodedHistoryUrl: string | readonly string[]
): string {
	const encodedValue =
		typeof encodedHistoryUrl === 'string'
			? encodedHistoryUrl
			: encodedHistoryUrl.join('/');

	try {
		return decodeURIComponent(encodedValue);
	} catch {
		return encodedValue;
	}
}
