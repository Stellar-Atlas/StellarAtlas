export function getHistoryArchiveObjectHostIdentity(
	archiveUrl: string
): string {
	try {
		const url = new URL(archiveUrl);
		return url.host.toLowerCase();
	} catch {
		return archiveUrl.trim().toLowerCase();
	}
}
