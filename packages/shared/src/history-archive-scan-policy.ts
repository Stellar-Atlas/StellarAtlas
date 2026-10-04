/** Operator scan exclusions never remove source evidence or quorum records. */
export function excludedHistoryArchiveHosts(
	value = process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS ?? ''
): readonly string[] {
	const hosts = value
		.split(',')
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean);
	for (const host of hosts) {
		if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/.test(host)) {
			throw new Error('Invalid HISTORY_ARCHIVE_EXCLUDED_HOSTS entry');
		}
	}
	return [...new Set(hosts)];
}

export function historyArchiveScanEnabled(url: string): boolean {
	try {
		return !excludedHistoryArchiveHosts().includes(
			new URL(url).host.toLowerCase()
		);
	} catch (error) {
		if (error instanceof TypeError) return false;
		throw error;
	}
}
