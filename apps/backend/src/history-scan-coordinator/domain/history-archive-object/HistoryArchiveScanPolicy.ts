import { excludedHistoryArchiveHosts } from 'shared';
// Preserve the backend import surface while all callers share one URL policy.
export { excludedHistoryArchiveHosts, historyArchiveScanEnabled } from 'shared';

export function historyArchiveHostScanAllowedSql(alias: string): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid scan policy SQL alias');
	const hosts = excludedHistoryArchiveHosts();
	return hosts.length === 0
		? 'true'
		: `${alias}."hostIdentity" not in (${hosts.map((host) => `'${host}'`).join(', ')})`;
}

/** Ready rows carry normalized archive URL identities, not a separate host column. */
export function historyArchiveReadyUrlScanAllowedSql(alias: string): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid scan policy SQL alias');
	const hosts = excludedHistoryArchiveHosts();
	return hosts.length === 0
		? 'true'
		: `substring(lower(${alias}."archiveUrlIdentity") from '^https?://([^/?#]+)') not in (${hosts.map((host) => `'${host}'`).join(', ')})`;
}
