import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';

export type HistoryArchiveObjectFailureClass =
	| 'http'
	| 'auth'
	| 'not-found'
	| 'rate-limit'
	| 'timeout'
	| 'transport'
	| 'worker'
	| 'coordinator'
	| 'unknown';

export type HistoryArchiveObjectEvidenceClass =
	| 'archive-object'
	| 'worker-infrastructure'
	| 'coordinator-infrastructure';

export interface HistoryArchiveObjectRetryPolicyInput {
	readonly now: Date;
	readonly currentRetryCount: number;
	readonly objectType: HistoryArchiveObjectType;
	readonly httpStatus?: number | null;
	readonly errorType?: string | null;
}

export interface HistoryArchiveObjectRetryPolicyResult {
	readonly delayMs: number;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClass;
	readonly failureClass: HistoryArchiveObjectFailureClass;
	readonly isArchiveObjectEvidence: boolean;
	readonly nextAttemptAt: Date;
	readonly retryCount: number;
}

const objectBaseDelayMs: Record<HistoryArchiveObjectType, number> = {
	'history-archive-state': 30_000,
	'checkpoint-state': 45_000,
	ledger: 60_000,
	transactions: 60_000,
	results: 60_000,
	bucket: 120_000
};

const failureDelayMultiplier: Record<HistoryArchiveObjectFailureClass, number> = {
	http: 2,
	auth: 8,
	'not-found': 4,
	'rate-limit': 6,
	timeout: 2,
	transport: 2,
	worker: 1,
	coordinator: 1,
	unknown: 3
};

const failureDelayCapMs: Record<HistoryArchiveObjectFailureClass, number> = {
	http: 30 * 60_000,
	auth: 6 * 60 * 60_000,
	'not-found': 6 * 60 * 60_000,
	'rate-limit': 2 * 60 * 60_000,
	timeout: 30 * 60_000,
	transport: 30 * 60_000,
	worker: 5 * 60_000,
	coordinator: 5 * 60_000,
	unknown: 60 * 60_000
};

const maxExponentialStep = 10;

export function getHistoryArchiveObjectRetryPolicy(
	input: HistoryArchiveObjectRetryPolicyInput
): HistoryArchiveObjectRetryPolicyResult {
	const retryCount = normalizeRetryCount(input.currentRetryCount) + 1;
	const failureClass = classifyHistoryArchiveObjectFailure({
		errorType: input.errorType,
		httpStatus: input.httpStatus
	});
	const evidenceClass = getHistoryArchiveObjectEvidenceClass(failureClass);
	const delayMs = getHistoryArchiveObjectRetryDelayMs({
		currentRetryCount: input.currentRetryCount,
		failureClass,
		objectType: input.objectType
	});

	return {
		delayMs,
		evidenceClass,
		failureClass,
		isArchiveObjectEvidence: evidenceClass === 'archive-object',
		nextAttemptAt: new Date(input.now.getTime() + delayMs),
		retryCount
	};
}

export function classifyHistoryArchiveObjectFailure(input: {
	readonly errorType?: string | null;
	readonly httpStatus?: number | null;
}): HistoryArchiveObjectFailureClass {
	const httpFailureClass = classifyHttpStatus(input.httpStatus);
	if (httpFailureClass !== null) return httpFailureClass;

	const normalizedErrorType = normalizeErrorType(input.errorType);
	if (normalizedErrorType === '') return 'unknown';

	if (includesAny(normalizedErrorType, ['AUTH', 'UNAUTHORIZED', 'FORBIDDEN'])) {
		return 'auth';
	}
	if (includesAny(normalizedErrorType, ['NOT_FOUND', 'ENOENT', 'MISSING'])) {
		return 'not-found';
	}
	if (includesAny(normalizedErrorType, ['RATE_LIMIT', 'TOO_MANY_REQUESTS'])) {
		return 'rate-limit';
	}
	if (includesAny(normalizedErrorType, ['TIMEOUT', 'TIMEDOUT', 'ABORT'])) {
		return 'timeout';
	}
	if (includesAny(normalizedErrorType, ['HTTP', 'STATUS'])) return 'http';
	if (
		includesAny(normalizedErrorType, [
			'ECONN',
			'EAI_',
			'ENOTFOUND',
			'NETWORK',
			'SOCKET',
			'TLS',
			'TRANSPORT'
		])
	) {
		return 'transport';
	}
	if (includesAny(normalizedErrorType, ['WORKER', 'SCANNER'])) return 'worker';
	if (includesAny(normalizedErrorType, ['COORDINATOR', 'CLAIM', 'LEASE'])) {
		return 'coordinator';
	}

	return 'unknown';
}

export function getHistoryArchiveObjectEvidenceClass(
	failureClass: HistoryArchiveObjectFailureClass
): HistoryArchiveObjectEvidenceClass {
	if (failureClass === 'worker') return 'worker-infrastructure';
	if (failureClass === 'coordinator') return 'coordinator-infrastructure';

	return 'archive-object';
}

export function getHistoryArchiveObjectRetryDelayMs(input: {
	readonly currentRetryCount: number;
	readonly failureClass: HistoryArchiveObjectFailureClass;
	readonly objectType: HistoryArchiveObjectType;
}): number {
	const exponentialStep = Math.min(
		normalizeRetryCount(input.currentRetryCount),
		maxExponentialStep
	);
	const uncappedDelay =
		objectBaseDelayMs[input.objectType] *
		failureDelayMultiplier[input.failureClass] *
		2 ** exponentialStep;

	return Math.min(uncappedDelay, failureDelayCapMs[input.failureClass]);
}

function classifyHttpStatus(
	httpStatus: number | null | undefined
): HistoryArchiveObjectFailureClass | null {
	if (typeof httpStatus !== 'number' || !Number.isInteger(httpStatus)) {
		return null;
	}
	if (httpStatus === 401 || httpStatus === 403) return 'auth';
	if (httpStatus === 404 || httpStatus === 410) return 'not-found';
	if (httpStatus === 408 || httpStatus === 504) return 'timeout';
	if (httpStatus === 429) return 'rate-limit';
	if (httpStatus >= 400) return 'http';

	return null;
}

function normalizeRetryCount(currentRetryCount: number): number {
	if (!Number.isSafeInteger(currentRetryCount) || currentRetryCount < 0) return 0;

	return currentRetryCount;
}

function normalizeErrorType(errorType: string | null | undefined): string {
	return (errorType ?? '').trim().replaceAll('-', '_').toUpperCase();
}

function includesAny(value: string, needles: readonly string[]): boolean {
	return needles.some((needle) => value.includes(needle));
}
