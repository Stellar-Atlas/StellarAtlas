import type {
	PublicHistoryArchiveObjectEventType,
	PublicHistoryArchiveObjectEvidenceClass,
	PublicHistoryArchiveObjectStatus,
	PublicHistoryArchiveObjectType
} from './archive-evidence-types';

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
