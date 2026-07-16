import type {
	HistoryArchiveStateSnapshotV1,
	HistoryArchivePublicVerificationFactsV1,
	HistoryArchivePublicCategorySummaryV1
} from 'shared';
import {
	historyArchiveWorkerStages,
	type HistoryArchiveObjectFailureChannelDTO
} from 'history-scanner-dto';

const digestPattern = /^[0-9a-f]{64}$/;
const publicWorkerStages = new Set<string>([
	...historyArchiveWorkerStages,
	'captured_history_archive_state',
	'failed',
	'verified'
]);
const publicArchiveErrorTypes = new Set([
	'archive_http_error',
	'bucket_verification_failed',
	'category_content_invalid',
	'invalid_checkpoint_state',
	'invalid_history_archive_state',
	'remote_content_invalid',
	'remote_missing'
]);

export function mapPublicVerificationFacts(
	value: object | null
): HistoryArchivePublicVerificationFactsV1 | null {
	if (!isRecord(value)) return null;
	const facts: MutablePublicFacts = {};
	const content = mapContent(value.content);
	if (content !== null) facts.content = content;
	const bucketObject = mapBucketObject(value.bucketObject);
	if (bucketObject !== null) facts.bucketObject = bucketObject;
	const checkpoint = mapCheckpointFact(value.checkpointHistoryArchiveStateFact);
	if (checkpoint !== null) facts.checkpointHistoryArchiveStateFact = checkpoint;
	const ledgerCategory = mapCategory(value.ledgerCategory);
	if (ledgerCategory !== null) facts.ledgerCategory = ledgerCategory;
	const resultsCategory = mapCategory(value.resultsCategory);
	if (resultsCategory !== null) facts.resultsCategory = resultsCategory;
	const transactionsCategory = mapCategory(value.transactionsCategory);
	if (transactionsCategory !== null) {
		facts.transactionsCategory = transactionsCategory;
	}
	const scpCategory = mapScpCategory(value.scpCategory);
	if (scpCategory !== null) facts.scpCategory = scpCategory;
	return Object.keys(facts).length === 0 ? null : facts;
}

export function mapPublicArchiveError(input: {
	readonly errorMessage: string | null;
	readonly errorType: string | null;
	readonly failureChannel: HistoryArchiveObjectFailureChannelDTO | null;
	readonly httpStatus: number | null;
}): {
	readonly httpStatus: number | null;
	readonly message: string;
	readonly type: string;
} | null {
	if (input.errorMessage === null && input.errorType === null) return null;
	if (input.failureChannel === 'scanner_issue') {
		return {
			httpStatus: null,
			message: 'Scanner infrastructure issue',
			type: 'scanner_issue'
		};
	}
	const httpStatus = isErrorHttpStatus(input.httpStatus)
		? input.httpStatus
		: null;
	const type =
		input.errorType !== null && publicArchiveErrorTypes.has(input.errorType)
			? input.errorType
			: 'archive_verification_failed';
	return {
		httpStatus,
		message:
			httpStatus === null
				? 'Remote archive verification failed'
				: `Remote archive returned HTTP ${httpStatus.toString()}`,
		type
	};
}

export function mapPublicWorkerStage(value: string | null): string | null {
	return value !== null && publicWorkerStages.has(value) ? value : null;
}

export function mapPublicArchiveUrl(value: string): string {
	if (
		value.length === 0 ||
		value.length > 2_048 ||
		value.trim() !== value ||
		/[\s\u0000-\u001f\u007f]/u.test(value)
	) {
		return '[redacted]';
	}
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') &&
			url.username === '' &&
			url.password === ''
			? value
			: '[redacted]';
	} catch {
		return '[redacted]';
	}
}

export function mapPublicArchiveState(
	state: HistoryArchiveStateSnapshotV1
): HistoryArchiveStateSnapshotV1 {
	return {
		...state,
		archiveUrl: mapPublicArchiveUrl(state.archiveUrl),
		archiveUrlIdentity: mapPublicArchiveUrl(state.archiveUrlIdentity),
		failure:
			state.failure === null
				? null
				: {
						httpStatus: isHttpStatus(state.failure.httpStatus)
							? state.failure.httpStatus
							: null,
						message: 'History archive state is unavailable',
						type: 'archive_state_unavailable'
					},
		latestFailure:
			state.latestFailure === null
				? null
				: {
						...state.latestFailure,
						httpStatus: isHttpStatus(state.latestFailure.httpStatus)
							? state.latestFailure.httpStatus
							: null,
						message: 'History archive state is unavailable',
						type: 'archive_state_unavailable'
					},
		metadata:
			state.metadata === null
				? null
				: {
						...state.metadata,
						stellarHistoryUrl: mapPublicArchiveUrl(
							state.metadata.stellarHistoryUrl
						)
					},
		stateUrl: mapPublicArchiveUrl(state.stateUrl)
	};
}

type MutablePublicFacts = {
	-readonly [
		Key in keyof HistoryArchivePublicVerificationFactsV1
	]?: HistoryArchivePublicVerificationFactsV1[Key];
};

function mapContent(
	value: unknown
): HistoryArchivePublicVerificationFactsV1['content'] | null {
	if (!isRecord(value)) return null;
	const digest = readDigest(value.digest);
	if (
		value.algorithm !== 'sha256' ||
		digest === null ||
		(value.representation !== 'canonical-json' &&
			value.representation !== 'uncompressed-xdr')
	) {
		return null;
	}
	return {
		algorithm: 'sha256',
		digest,
		representation: value.representation
	};
}

function mapBucketObject(
	value: unknown
): HistoryArchivePublicVerificationFactsV1['bucketObject'] | null {
	if (!isRecord(value)) return null;
	const expectedBucketHash = readDigest(value.expectedBucketHash);
	if (
		expectedBucketHash === null ||
		value.hashAlgorithm !== 'sha256' ||
		value.matched !== true
	) {
		return null;
	}
	return { expectedBucketHash, hashAlgorithm: 'sha256', matched: true };
}

function mapCheckpointFact(
	value: unknown
):
	| HistoryArchivePublicVerificationFactsV1['checkpointHistoryArchiveStateFact']
	| null {
	if (!isRecord(value)) return null;
	const bucketListHash = readDigest(value.bucketListHash);
	if (
		bucketListHash === null ||
		!isLedger(value.checkpointLedger) ||
		!isDateTime(value.observedAt)
	) {
		return null;
	}
	return {
		bucketListHash,
		checkpointLedger: value.checkpointLedger,
		observedAt: value.observedAt
	};
}

function mapCategory(
	value: unknown
): HistoryArchivePublicCategorySummaryV1 | null {
	if (!isRecord(value) || !isCount(value.entryCount)) return null;
	if (!Array.isArray(value.ledgers) || value.ledgers.length > 10_000) {
		return {
			entryCount: value.entryCount,
			firstLedger: null,
			lastLedger: null,
			ledgerCount: 0
		};
	}
	const ledgers = new Set<number>();
	for (const entry of value.ledgers) {
		if (isRecord(entry) && isLedger(entry.ledger)) ledgers.add(entry.ledger);
	}
	const ordered = [...ledgers].toSorted((left, right) => left - right);
	return {
		entryCount: value.entryCount,
		firstLedger: ordered[0] ?? null,
		lastLedger: ordered.at(-1) ?? null,
		ledgerCount: ordered.length
	};
}

function mapScpCategory(
	value: unknown
): HistoryArchivePublicVerificationFactsV1['scpCategory'] | null {
	return isRecord(value) && isCount(value.entryCount)
		? { entryCount: value.entryCount }
		: null;
}

function readDigest(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.toLowerCase();
	return digestPattern.test(normalized) ? normalized : null;
}

function isCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isLedger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isDateTime(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isHttpStatus(value: number | null): value is number {
	return (
		Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599
	);
}

function isErrorHttpStatus(value: number | null): value is number {
	return isHttpStatus(value) && (Number(value) < 200 || Number(value) >= 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
