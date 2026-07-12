import type {
	PublicHistoryArchiveObjectEventType,
	PublicHistoryArchiveObjectEvidenceClass,
	PublicHistoryArchiveObjectStatus,
	PublicHistoryArchiveObjectType,
	PublicKnownNodeArchiveEvidence,
	PublicKnownOrganizationArchiveEvidence
} from './archive-evidence-types';
import type { PublicKnownNode, PublicKnownOrganization } from './types';
import { ApiClientError, fetchJson, type FetchOptions } from './client';
import { frontendCacheTags } from './cache-policy';

export const fetchKnownNode = (
	publicKey: string,
	options?: FetchOptions
): Promise<PublicKnownNode | null> =>
	fetchKnownRecord(`/v1/known/nodes/${encodeURIComponent(publicKey)}`, options);

export const fetchKnownOrganization = (
	organizationId: string,
	options?: FetchOptions
): Promise<PublicKnownOrganization | null> =>
	fetchKnownRecord(
		`/v1/known/organizations/${encodeURIComponent(organizationId)}`,
		options
	);

export interface KnownArchiveEvidenceQuery {
	readonly archiveUrl?: string;
	readonly copyLimit?: number;
	readonly eventCursor?: string;
	readonly eventEvidenceClass?: PublicHistoryArchiveObjectEvidenceClass;
	readonly eventLimit?: number;
	readonly eventObjectType?: PublicHistoryArchiveObjectType;
	readonly eventType?: PublicHistoryArchiveObjectEventType;
	readonly failureCursor?: string;
	readonly failureLimit?: number;
	readonly failureObjectType?: PublicHistoryArchiveObjectType;
	readonly objectCursor?: string;
	readonly objectLimit?: number;
	readonly objectStatus?: PublicHistoryArchiveObjectStatus;
	readonly objectType?: PublicHistoryArchiveObjectType;
	readonly workerIssueCursor?: string;
	readonly workerIssueLimit?: number;
}

export const fetchKnownNodeArchiveEvidence = (
	publicKey: string,
	query: KnownArchiveEvidenceQuery = {},
	options?: FetchOptions
): Promise<PublicKnownNodeArchiveEvidence | null> =>
	fetchKnownRecord(
		buildArchiveEvidencePath(
			`/v1/known/nodes/${encodeURIComponent(publicKey)}/archive-evidence`,
			query
		),
		withArchiveEvidenceTags(options)
	);

export const fetchKnownOrganizationArchiveEvidence = (
	organizationId: string,
	query: KnownArchiveEvidenceQuery = {},
	options?: FetchOptions
): Promise<PublicKnownOrganizationArchiveEvidence | null> =>
	fetchKnownRecord(
		buildArchiveEvidencePath(
			`/v1/known/organizations/${encodeURIComponent(organizationId)}/archive-evidence`,
			query
		),
		withArchiveEvidenceTags(options)
	);

async function fetchKnownRecord<Record>(
	path: string,
	options?: FetchOptions
): Promise<Record | null> {
	try {
		return await fetchJson<Record>(path, withNetworkTags(options));
	} catch (error) {
		if (error instanceof ApiClientError && error.statusCode === 404) {
			return null;
		}
		throw error;
	}
}

function withNetworkTags(options: FetchOptions | undefined): FetchOptions {
	return {
		...options,
		tags: [frontendCacheTags.network, ...(options?.tags ?? [])]
	};
}

function withArchiveEvidenceTags(
	options: FetchOptions | undefined
): FetchOptions {
	return {
		...options,
		tags: [frontendCacheTags.historyScan, ...(options?.tags ?? [])]
	};
}

export function buildArchiveEvidencePath(
	path: string,
	query: KnownArchiveEvidenceQuery
): string {
	const params = new URLSearchParams();
	setStringParam(params, 'archiveUrl', query.archiveUrl);
	setNumberParam(params, 'copyLimit', query.copyLimit);
	setStringParam(params, 'eventCursor', query.eventCursor);
	setStringParam(params, 'eventEvidenceClass', query.eventEvidenceClass);
	setNumberParam(params, 'eventLimit', query.eventLimit);
	setStringParam(params, 'eventObjectType', query.eventObjectType);
	setStringParam(params, 'eventType', query.eventType);
	setStringParam(params, 'failureCursor', query.failureCursor);
	setNumberParam(params, 'failureLimit', query.failureLimit);
	setStringParam(params, 'failureObjectType', query.failureObjectType);
	setStringParam(params, 'objectCursor', query.objectCursor);
	setNumberParam(params, 'objectLimit', query.objectLimit);
	setStringParam(params, 'objectStatus', query.objectStatus);
	setStringParam(params, 'objectType', query.objectType);
	setStringParam(params, 'workerIssueCursor', query.workerIssueCursor);
	setNumberParam(params, 'workerIssueLimit', query.workerIssueLimit);
	const queryString = params.toString();
	return queryString.length === 0 ? path : `${path}?${queryString}`;
}

function setStringParam(
	params: URLSearchParams,
	name: string,
	value: string | undefined
): void {
	if (value !== undefined) params.set(name, value);
}

function setNumberParam(
	params: URLSearchParams,
	name: string,
	value: number | undefined
): void {
	if (value !== undefined) params.set(name, value.toString());
}
