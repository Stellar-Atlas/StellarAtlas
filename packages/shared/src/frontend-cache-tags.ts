export const frontendCacheTags = {
	historyScan: 'history-scan',
	network: 'network',
	organizations: 'organizations',
	scpStatements: 'scp-statements',
	status: 'status'
} as const;

export type FrontendCacheTag =
	(typeof frontendCacheTags)[keyof typeof frontendCacheTags];
