import type { PublicNetwork } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const isPublicNetwork = (value: unknown): value is PublicNetwork => {
	if (!isRecord(value)) return false;
	return (
		hasStrings(value, ['id', 'latestLedger', 'name', 'passPhrase', 'time']) &&
		isNetworkStatistics(value.statistics) &&
		Array.isArray(value.nodes) &&
		value.nodes.every(isNetworkNode) &&
		Array.isArray(value.organizations) &&
		value.organizations.every(isNetworkOrganization) &&
		isStringArray(value.transitiveQuorumSet) &&
		Array.isArray(value.scc) &&
		value.scc.every(isStringArray) &&
		isOptionalNumber(value.overlayMinVersion) &&
		isOptionalNumber(value.overlayVersion) &&
		isOptionalNumber(value.maxLedgerVersion) &&
		isOptionalString(value.stellarCoreVersion) &&
		(value.quorumSetConfiguration === undefined ||
			isQuorumSet(value.quorumSetConfiguration))
	);
};

const isNetworkNode = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	return (
		hasStrings(value, ['dateDiscovered', 'dateUpdated', 'ip', 'publicKey']) &&
		hasNumbers(value, ['index', 'port']) &&
		hasBooleans(value, [
			'active',
			'activeInScp',
			'connectivityError',
			'historyArchiveHasError',
			'isFullValidator',
			'isValidating',
			'isValidator',
			'overLoaded',
			'stellarCoreVersionBehind'
		]) &&
		[
			'alias',
			'historyUrl',
			'homeDomain',
			'host',
			'isp',
			'name',
			'organizationId',
			'quorumSetHashKey',
			'versionStr'
		].every((key) => isNullableString(value[key])) &&
		['lag', 'ledgerVersion', 'overlayMinVersion', 'overlayVersion'].every(
			(key) => isNullableNumber(value[key])
		) &&
		(value.quorumSet === null || isQuorumSet(value.quorumSet)) &&
		isNodeStatistics(value.statistics) &&
		(value.geoData === null || isNodeGeoData(value.geoData))
	);
};

const isNetworkOrganization = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	return (
		hasStrings(value, ['dateDiscovered', 'homeDomain', 'id', 'tomlState']) &&
		hasNumbers(value, [
			'subQuorum24HoursAvailability',
			'subQuorum30DaysAvailability'
		]) &&
		hasBooleans(value, [
			'has24HourStats',
			'has30DayStats',
			'hasReliableUptime',
			'subQuorumAvailable'
		]) &&
		[
			'dba',
			'description',
			'github',
			'horizonUrl',
			'keybase',
			'logo',
			'name',
			'officialEmail',
			'phoneNumber',
			'physicalAddress',
			twitterKey,
			'url'
		].every((key) => isNullableString(value[key])) &&
		isStringArray(value.validators) &&
		isStringArray(value.tomlWarnings) &&
		isOptionalTomlAttempt(value.tomlLatestAttempt) &&
		isOptionalTomlAttempt(value.tomlLatestFailure) &&
		isOptionalTomlAttempt(value.tomlLatestInsecureAttempt) &&
		(value.stellarToml === null || isStellarToml(value.stellarToml))
	);
};

const twitterKey = 'twitter';

const isNetworkStatistics = (value: unknown): boolean => {
	if (!isRecord(value) || typeof value.time !== 'string') return false;
	return (
		hasNumbers(value, [
			'minBlockingSetCountryFilteredSize',
			'minBlockingSetCountrySize',
			'minBlockingSetFilteredSize',
			'minBlockingSetISPFilteredSize',
			'minBlockingSetISPSize',
			'minBlockingSetOrgsFilteredSize',
			'minBlockingSetOrgsSize',
			'minBlockingSetSize',
			'minSplittingSetCountrySize',
			'minSplittingSetISPSize',
			'minSplittingSetOrgsSize',
			'minSplittingSetSize',
			'nrOfActiveFullValidators',
			'nrOfActiveOrganizations',
			'nrOfActiveValidators',
			'nrOfActiveWatchers',
			'nrOfConnectableNodes',
			'topTierOrgsSize',
			'topTierSize',
			'transitiveQuorumSetSize'
		]) &&
		hasBooleans(value, [
			'hasQuorumIntersection',
			'hasSymmetricTopTier',
			'hasTransitiveQuorumSet'
		])
	);
};

const isNodeStatistics = (value: unknown): boolean =>
	isRecord(value) &&
	hasNumbers(value, [
		'active24HoursPercentage',
		'active30DaysPercentage',
		'overLoaded24HoursPercentage',
		'overLoaded30DaysPercentage',
		'validating24HoursPercentage',
		'validating30DaysPercentage'
	]) &&
	hasBooleans(value, ['has24HourStats', 'has30DayStats']);

const isNodeGeoData = (value: unknown): boolean =>
	isRecord(value) &&
	isNullableString(value.countryCode) &&
	isNullableString(value.countryName) &&
	isNullableNumber(value.latitude) &&
	isNullableNumber(value.longitude);

const isQuorumSet = (value: unknown, depth = 0): boolean =>
	depth <= 8 &&
	isRecord(value) &&
	typeof value.threshold === 'number' &&
	isStringArray(value.validators) &&
	Array.isArray(value.innerQuorumSets) &&
	value.innerQuorumSets.every((inner) => isQuorumSet(inner, depth + 1));

const isStellarToml = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.content === 'string' &&
	typeof value.url === 'string' &&
	isOptionalString(value.observedAt) &&
	(value.warnings === undefined || isStringArray(value.warnings));

const isOptionalTomlAttempt = (value: unknown): boolean =>
	value === undefined || value === null || isTomlAttempt(value);

const isTomlAttempt = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value.observedAt === 'string' &&
	(value.result === 'success' || value.result === 'failure') &&
	typeof value.state === 'string' &&
	isStringArray(value.warnings) &&
	(value.authoritative === undefined ||
		typeof value.authoritative === 'boolean') &&
	(value.contentCaptured === undefined ||
		typeof value.contentCaptured === 'boolean');

const hasStrings = (
	value: Record<string, unknown>,
	keys: readonly string[]
): boolean => keys.every((key) => typeof value[key] === 'string');

const hasNumbers = (
	value: Record<string, unknown>,
	keys: readonly string[]
): boolean =>
	keys.every(
		(key) => typeof value[key] === 'number' && Number.isFinite(value[key])
	);

const hasBooleans = (
	value: Record<string, unknown>,
	keys: readonly string[]
): boolean => keys.every((key) => typeof value[key] === 'boolean');

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isNullableString = (value: unknown): boolean =>
	value === null || typeof value === 'string';

const isOptionalString = (value: unknown): boolean =>
	value === undefined || typeof value === 'string';

const isNullableNumber = (value: unknown): boolean =>
	value === null || (typeof value === 'number' && Number.isFinite(value));

const isOptionalNumber = (value: unknown): boolean =>
	value === undefined || (typeof value === 'number' && Number.isFinite(value));
