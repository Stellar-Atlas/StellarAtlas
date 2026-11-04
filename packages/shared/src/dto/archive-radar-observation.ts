import { normalizeHistoryArchiveRootUrl } from '../history-archive-url.js';

export type ArchiveRadarErrorCode =
	| 'invalid_request'
	| 'busy'
	| 'upstream_http'
	| 'invalid_response'
	| 'upstream_timeout'
	| 'upstream_unavailable';
export interface ArchiveRadarObservation {
	readonly fetchedAt: string;
	readonly contentHashSha256: string;
	readonly scanStartedAt: string;
	readonly scanEndedAt: string;
	readonly hasError: boolean;
	readonly errorObjectUrl: string | null;
	readonly attribution: 'unclassified';
	readonly checkpointScope: 'unknown';
	readonly findingCoverage: 'unknown';
}
export interface ArchiveRadarResponse {
	readonly schemaVersion: 1;
	readonly archiveUrl: string | null;
	readonly source: 'withobsrvr-radar';
	readonly status:
		'loaded' | 'not_found' | 'unavailable' | 'busy' | 'invalid_request';
	readonly errorCode: ArchiveRadarErrorCode | null;
	/** Original lookup completion time, also retained for null observations on cache hits. */
	readonly lookupAt: string | null;
	readonly servedAt: string;
	readonly cached: boolean;
	readonly observation: ArchiveRadarObservation | null;
}

export function archiveRadarHttpStatus(dto: ArchiveRadarResponse): number {
	return dto.status === 'invalid_request'
		? 400
		: dto.status === 'busy'
			? 429
			: dto.status === 'unavailable'
				? dto.errorCode === 'upstream_timeout'
					? 504
					: 502
				: 200;
}

export function publicArchiveRootIdentity(value: string): string | null {
	try {
		const url = new URL(value);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.href.includes('?') ||
			url.href.includes('#')
		)
			return null;
		return normalizeHistoryArchiveRootUrl(value);
	} catch {
		return null;
	}
}

export function archiveRadarObjectUrl(
	value: string | null,
	root: string
): string | null {
	if (value === null) return null;
	try {
		const url = new URL(value),
			archive = new URL(root);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.href.includes('?') ||
			url.href.includes('#') ||
			url.origin !== archive.origin ||
			(url.pathname !== archive.pathname &&
				!url.pathname.startsWith(archive.pathname.replace(/\/$/, '') + '/')) ||
			new TextEncoder().encode(url.href).length > 2048
		)
			return null;
		return url.href;
	} catch {
		return null;
	}
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
	Object.keys(value).length === keys.length &&
	keys.every((key) => Object.hasOwn(value, key));
const instant = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 40 &&
	Number.isFinite(Date.parse(value));

/** Strict public boundary: unknown fields and contradictory status/code combinations are rejected. */
export function isArchiveRadarResponse(
	value: unknown
): value is ArchiveRadarResponse {
	if (
		!record(value) ||
		!exactKeys(value, [
			'schemaVersion',
			'archiveUrl',
			'source',
			'status',
			'errorCode',
			'lookupAt',
			'servedAt',
			'cached',
			'observation'
		]) ||
		value.schemaVersion !== 1 ||
		value.source !== 'withobsrvr-radar' ||
		typeof value.cached !== 'boolean' ||
		!instant(value.servedAt)
	)
		return false;
	const root = value.archiveUrl;
	if (
		root !== null &&
		(typeof root !== 'string' ||
			new TextEncoder().encode(root).length > 2048 ||
			publicArchiveRootIdentity(root) !== root)
	)
		return false;
	if (value.status === 'invalid_request' || value.status === 'busy') {
		return (
			value.errorCode === value.status &&
			value.lookupAt === null &&
			value.observation === null &&
			value.cached === false &&
			(value.status !== 'invalid_request' || root === null)
		);
	}
	if (root === null || !instant(value.lookupAt)) return false;
	if (value.status === 'not_found')
		return value.errorCode === null && value.observation === null;
	if (value.status === 'unavailable')
		return (
			[
				'upstream_http',
				'invalid_response',
				'upstream_timeout',
				'upstream_unavailable'
			].includes(String(value.errorCode)) && value.observation === null
		);
	if (value.status !== 'loaded' || value.errorCode !== null) return false;
	const observation = value.observation;
	return (
		record(observation) &&
		exactKeys(observation, [
			'fetchedAt',
			'contentHashSha256',
			'scanStartedAt',
			'scanEndedAt',
			'hasError',
			'errorObjectUrl',
			'attribution',
			'checkpointScope',
			'findingCoverage'
		]) &&
		instant(observation.fetchedAt) &&
		instant(observation.scanStartedAt) &&
		instant(observation.scanEndedAt) &&
		typeof observation.contentHashSha256 === 'string' &&
		/^[a-f0-9]{64}$/.test(observation.contentHashSha256) &&
		typeof observation.hasError === 'boolean' &&
		observation.attribution === 'unclassified' &&
		observation.checkpointScope === 'unknown' &&
		observation.findingCoverage === 'unknown' &&
		(observation.errorObjectUrl === null ||
			(typeof observation.errorObjectUrl === 'string' &&
				archiveRadarObjectUrl(observation.errorObjectUrl, root) ===
					observation.errorObjectUrl))
	);
}
