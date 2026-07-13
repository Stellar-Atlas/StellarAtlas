import type {
	PublicCanonicalFullHistoryCoverage,
	PublicCanonicalLatestEvidence,
	PublicCanonicalSourceObjectEvidence
} from './canonical-history-types';
import {
	dateTime,
	literal,
	lowercaseSha256,
	matches,
	nonEmptyString,
	nonNegativeInteger,
	positiveInteger,
	type StatusLiveValidator,
	unsignedIntegerString,
	uuid
} from './status-live-validator-primitives';

const validateCanonicalJsonSourceObject =
	sourceObjectValidator('canonical-json');
const validateUncompressedXdrSourceObject =
	sourceObjectValidator('uncompressed-xdr');

export const validateCanonicalLatestEvidence: StatusLiveValidator = matches({
	archiveUrlIdentity: nonEmptyString,
	batchId: uuid,
	checkpointLedger: unsignedIntegerString,
	checkpointProofId: positiveInteger,
	decoderVersion: nonEmptyString,
	firstLedger: unsignedIntegerString,
	ingestedAt: dateTime,
	lastLedger: unsignedIntegerString,
	proofEvaluatedAt: dateTime,
	proofVersion: positiveInteger,
	sourceObjects: matches({
		checkpointState: validateCanonicalJsonSourceObject,
		ledger: validateUncompressedXdrSourceObject,
		results: validateUncompressedXdrSourceObject,
		transactions: validateUncompressedXdrSourceObject
	})
});

const validateCanonicalCoverageShape = matches(
	{
		archiveSourceCount: positiveInteger,
		batchCount: positiveInteger,
		firstLedger: unsignedIntegerString,
		lastLedger: unsignedIntegerString,
		latestLedgerClosedAt: dateTime,
		ledgerCount: positiveInteger,
		nextLedger: unsignedIntegerString,
		rangeKind: literal('contiguous_bounded'),
		transactionCount: nonNegativeInteger,
		transactionResultCount: nonNegativeInteger,
		updatedAt: dateTime
	},
	{
		latestEvidence: validateCanonicalLatestEvidence,
		source: literal('postgres_canonical')
	}
);

export const validateCanonicalFullHistoryCoverage: StatusLiveValidator = (
	value
) => validateCanonicalCoverageShape(value) && hasCoherentCoverage(value);

export function sanitizeCanonicalFullHistoryCoverage(
	value: unknown
): PublicCanonicalFullHistoryCoverage {
	if (!validateCanonicalFullHistoryCoverage(value)) {
		throw new Error('Canonical coverage failed validation');
	}
	const source = record(value);
	return {
		archiveSourceCount: numberValue(source.archiveSourceCount),
		batchCount: numberValue(source.batchCount),
		firstLedger: stringValue(source.firstLedger),
		lastLedger: stringValue(source.lastLedger),
		latestEvidence:
			source.latestEvidence === undefined
				? null
				: sanitizeCanonicalLatestEvidence(source.latestEvidence),
		latestLedgerClosedAt: stringValue(source.latestLedgerClosedAt),
		ledgerCount: numberValue(source.ledgerCount),
		nextLedger: stringValue(source.nextLedger),
		rangeKind: 'contiguous_bounded',
		source: 'postgres_canonical',
		transactionCount: numberValue(source.transactionCount),
		transactionResultCount: numberValue(source.transactionResultCount),
		updatedAt: stringValue(source.updatedAt)
	};
}

export function sanitizeCanonicalLatestEvidence(
	value: unknown
): PublicCanonicalLatestEvidence {
	if (!validateCanonicalLatestEvidence(value)) {
		throw new Error('Canonical latest evidence failed validation');
	}
	const source = record(value);
	const sourceObjects = record(source.sourceObjects);
	return {
		archiveUrlIdentity: stringValue(source.archiveUrlIdentity),
		batchId: stringValue(source.batchId),
		checkpointLedger: stringValue(source.checkpointLedger),
		checkpointProofId: numberValue(source.checkpointProofId),
		decoderVersion: stringValue(source.decoderVersion),
		firstLedger: stringValue(source.firstLedger),
		ingestedAt: stringValue(source.ingestedAt),
		lastLedger: stringValue(source.lastLedger),
		proofEvaluatedAt: stringValue(source.proofEvaluatedAt),
		proofVersion: numberValue(source.proofVersion),
		sourceObjects: {
			checkpointState: sanitizeSourceObject(sourceObjects.checkpointState),
			ledger: sanitizeSourceObject(sourceObjects.ledger),
			results: sanitizeSourceObject(sourceObjects.results),
			transactions: sanitizeSourceObject(sourceObjects.transactions)
		}
	};
}

function sourceObjectValidator(
	representation: PublicCanonicalSourceObjectEvidence['representation']
): StatusLiveValidator {
	return matches({
		algorithm: literal('sha256'),
		contentDigest: lowercaseSha256,
		objectRemoteId: uuid,
		representation: literal(representation)
	});
}

function hasCoherentCoverage(value: unknown): boolean {
	const source = record(value);
	const firstLedger = BigInt(stringValue(source.firstLedger));
	const lastLedger = BigInt(stringValue(source.lastLedger));
	const nextLedger = BigInt(stringValue(source.nextLedger));
	if (firstLedger > lastLedger || nextLedger !== lastLedger + 1n) return false;
	const span = lastLedger - firstLedger + 1n;
	if (span !== BigInt(numberValue(source.ledgerCount))) return false;
	if (
		numberValue(source.transactionCount) !==
		numberValue(source.transactionResultCount)
	) {
		return false;
	}
	if (source.latestEvidence === undefined) return true;
	const evidence = record(source.latestEvidence);
	const evidenceFirst = BigInt(stringValue(evidence.firstLedger));
	const evidenceLast = BigInt(stringValue(evidence.lastLedger));
	return (
		evidenceLast === lastLedger &&
		BigInt(stringValue(evidence.checkpointLedger)) === evidenceLast &&
		evidenceFirst >= firstLedger &&
		evidenceFirst <= evidenceLast &&
		Date.parse(stringValue(evidence.proofEvaluatedAt)) <=
			Date.parse(stringValue(evidence.ingestedAt))
	);
}

function sanitizeSourceObject(
	value: unknown
): PublicCanonicalSourceObjectEvidence {
	const source = record(value);
	return {
		algorithm: 'sha256',
		contentDigest: stringValue(source.contentDigest),
		objectRemoteId: stringValue(source.objectRemoteId),
		representation:
			source.representation === 'canonical-json'
				? 'canonical-json'
				: 'uncompressed-xdr'
	};
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Canonical evidence changed shape after validation');
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Canonical evidence string changed after validation');
	}
	return value;
}

function numberValue(value: unknown): number {
	if (typeof value !== 'number') {
		throw new Error('Canonical evidence number changed after validation');
	}
	return value;
}
