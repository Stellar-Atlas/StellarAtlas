import {
	isHistoryArchiveContentReuseV1,
	isHistoryArchiveReusableContentV1,
	type HistoryArchiveContentReuseV1,
	type HistoryArchiveReusableContentV1
} from './history-archive-content-reuse-v1.js';

export interface HistoryArchiveReusableContentV2 extends HistoryArchiveContentReuseV1 {
	readonly format: 'compact-v2';
	readonly binding: {
		readonly remoteId: string;
		readonly executionId: string;
		readonly claimAttempt: number;
		readonly objectType: 'ledger' | 'transactions' | 'results';
		readonly objectKey: string;
		readonly checkpointLedger: number;
		readonly sourceUrl: string;
	};
	readonly summary: {
		readonly entryCount: number;
		readonly firstLedger: number | null;
		readonly lastLedger: number | null;
		readonly ledgerCount: number;
		readonly headerHashesVerified?: boolean;
	};
}
export type HistoryArchiveReusableContentResponse =
	HistoryArchiveReusableContentV1 | HistoryArchiveReusableContentV2;
const uuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHistoryArchiveReusableContentV2(
	value: unknown
): value is HistoryArchiveReusableContentV2 {
	if (
		!record(value) ||
		value.format !== 'compact-v2' ||
		'verificationFacts' in value ||
		!isHistoryArchiveContentReuseV1(value) ||
		!record(value.binding) ||
		!record(value.summary)
	)
		return false;
	const b = value.binding,
		s = value.summary;
	if (
		typeof b.remoteId !== 'string' ||
		!uuid.test(b.remoteId) ||
		typeof b.executionId !== 'string' ||
		!uuid.test(b.executionId) ||
		!nonnegative(b.claimAttempt) ||
		b.claimAttempt === 0 ||
		typeof b.objectType !== 'string' ||
		!['ledger', 'transactions', 'results'].includes(b.objectType) ||
		typeof b.objectKey !== 'string' ||
		b.objectKey.length === 0 ||
		!nonnegative(b.checkpointLedger) ||
		typeof b.sourceUrl !== 'string' ||
		b.sourceUrl.length === 0 ||
		!nonnegative(s.entryCount) ||
		!nonnegative(s.ledgerCount) ||
		s.ledgerCount > s.entryCount ||
		'ledgers' in s ||
		(s.headerHashesVerified !== undefined &&
			typeof s.headerHashesVerified !== 'boolean') ||
		(b.objectType === 'ledger' && s.headerHashesVerified !== true)
	)
		return false;
	if (s.ledgerCount === 0)
		return (
			s.entryCount === 0 && s.firstLedger === null && s.lastLedger === null
		);
	return (
		nonnegative(s.firstLedger) &&
		nonnegative(s.lastLedger) &&
		s.firstLedger <= s.lastLedger &&
		s.lastLedger <= b.checkpointLedger &&
		s.ledgerCount <= s.lastLedger - s.firstLedger + 1
	);
}
export function isHistoryArchiveReusableContentResponse(
	value: unknown
): value is HistoryArchiveReusableContentResponse {
	if (!record(value)) return false;
	return value.format === undefined
		? isHistoryArchiveReusableContentV1(value)
		: isHistoryArchiveReusableContentV2(value);
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonnegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
