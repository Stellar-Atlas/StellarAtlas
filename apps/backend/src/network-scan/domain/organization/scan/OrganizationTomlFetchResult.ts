export const ORGANIZATION_TOML_FETCH_RESULTS = [
	'not_attempted',
	'success',
	'failure'
] as const;

export type OrganizationTomlFetchResult =
	(typeof ORGANIZATION_TOML_FETCH_RESULTS)[number];

export type OrganizationTomlAttemptResult = Exclude<
	OrganizationTomlFetchResult,
	'not_attempted'
>;
