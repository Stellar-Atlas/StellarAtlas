import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';
import type { HistoryArchiveObjectVerificationFactsV1 } from './history-archive-object-verification-facts-v1.js';

export const historyArchiveContentDerivationVersionV1 = 1 as const;

export interface HistoryArchiveContentReuseRequestV1 {
	readonly claimAttempt: number;
	readonly contentDigest: string;
	readonly contentRepresentation: 'uncompressed-xdr';
	readonly derivationVersion: typeof historyArchiveContentDerivationVersionV1;
	readonly executionId: string;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectTypeV1;
	readonly remoteId: string;
}

export interface HistoryArchiveContentReuseV1 {
	readonly artifactId: string;
	readonly contentDigest: string;
	readonly contentRepresentation: 'uncompressed-xdr';
	readonly derivationVersion: typeof historyArchiveContentDerivationVersionV1;
	readonly sourceObjectRemoteId: string;
}

export interface HistoryArchiveReusableContentV1 extends HistoryArchiveContentReuseV1 {
	readonly verificationFacts: HistoryArchiveObjectVerificationFactsV1;
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;
const reusableTypes = new Set<HistoryArchiveObjectTypeV1>([
	'ledger',
	'transactions',
	'results',
	'scp'
]);

export function isHistoryArchiveContentReuseV1(
	value: unknown
): value is HistoryArchiveContentReuseV1 {
	if (!isRecord(value)) return false;
	return (
		typeof value.artifactId === 'string' &&
		uuidPattern.test(value.artifactId) &&
		typeof value.sourceObjectRemoteId === 'string' &&
		uuidPattern.test(value.sourceObjectRemoteId) &&
		typeof value.contentDigest === 'string' &&
		digestPattern.test(value.contentDigest) &&
		value.contentRepresentation === 'uncompressed-xdr' &&
		value.derivationVersion === historyArchiveContentDerivationVersionV1
	);
}

export function isHistoryArchiveReusableContentV1(
	value: unknown
): value is HistoryArchiveReusableContentV1 {
	if (!isRecord(value)) return false;
	return (
		isHistoryArchiveContentReuseV1(value) &&
		isRecord(value['verificationFacts'])
	);
}

export function isHistoryArchiveContentReuseRequestV1(
	value: unknown
): value is HistoryArchiveContentReuseRequestV1 {
	if (!isRecord(value)) return false;
	return (
		typeof value.remoteId === 'string' &&
		uuidPattern.test(value.remoteId) &&
		typeof value.executionId === 'string' &&
		uuidPattern.test(value.executionId) &&
		typeof value.claimAttempt === 'number' &&
		Number.isSafeInteger(value.claimAttempt) &&
		value.claimAttempt > 0 &&
		typeof value.objectType === 'string' &&
		reusableTypes.has(value.objectType as HistoryArchiveObjectTypeV1) &&
		typeof value.objectKey === 'string' &&
		value.objectKey.length > 0 &&
		typeof value.contentDigest === 'string' &&
		digestPattern.test(value.contentDigest) &&
		value.contentRepresentation === 'uncompressed-xdr' &&
		value.derivationVersion === historyArchiveContentDerivationVersionV1
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
