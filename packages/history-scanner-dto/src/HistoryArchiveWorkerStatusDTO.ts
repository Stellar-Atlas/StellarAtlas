export const historyArchiveObjectTypes = [
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
] as const;

export type HistoryArchiveObjectTypeDTO =
	(typeof historyArchiveObjectTypes)[number];

export const historyArchiveWorkerStages = [
	'idle',
	'claimed',
	'fetching_history_archive_state',
	'verified_history_archive_state',
	'fetching_checkpoint_state',
	'verified_checkpoint_state',
	'fetching_ledger',
	'downloading_ledger',
	'verified_ledger',
	'fetching_transactions',
	'downloading_transactions',
	'verified_transactions',
	'fetching_results',
	'downloading_results',
	'verified_results',
	'fetching_scp',
	'downloading_scp',
	'verified_scp',
	'fetching_bucket',
	'downloading_bucket',
	'verified_bucket'
] as const;

export type HistoryArchiveWorkerStageDTO =
	(typeof historyArchiveWorkerStages)[number];

export const historyArchiveWorkerOutcomes = [
	'none',
	'verified',
	'archive_error',
	'worker_issue',
	'released'
] as const;

export type HistoryArchiveWorkerOutcomeDTO =
	(typeof historyArchiveWorkerOutcomes)[number];

export interface HistoryArchiveWorkerObjectDTO {
	readonly remoteId: string;
	readonly source: string;
	readonly type: HistoryArchiveObjectTypeDTO;
}

export interface HistoryArchiveWorkerReportDTO {
	readonly bytesDownloaded: number | null;
	readonly claimAttempt: number | null;
	readonly currentObject: HistoryArchiveWorkerObjectDTO | null;
	readonly lastOutcome: HistoryArchiveWorkerOutcomeDTO;
	readonly lastOutcomeAt: string | null;
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: string;
	readonly sequence: number;
	readonly stage: HistoryArchiveWorkerStageDTO;
	readonly workerId: string;
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workerIdPattern = /^[a-zA-Z0-9._:-]{1,96}$/;

export function isHistoryArchiveWorkerReportDTO(
	value: unknown
): value is HistoryArchiveWorkerReportDTO {
	if (!isRecord(value)) return false;
	if (
		!hasOnlyKeys(value, [
			'bytesDownloaded',
			'claimAttempt',
			'currentObject',
			'lastOutcome',
			'lastOutcomeAt',
			'pid',
			'processGeneration',
			'processId',
			'processStartedAt',
			'sequence',
			'stage',
			'workerId'
		])
	) {
		return false;
	}
	if (!workerIdPattern.test(readString(value.workerId))) return false;
	if (!uuidPattern.test(readString(value.processId))) return false;
	if (!isPositiveInteger(value.pid)) return false;
	if (!isNonNegativeInteger(value.processGeneration)) return false;
	if (!isPositiveInteger(value.sequence)) return false;
	if (!isDateTime(value.processStartedAt)) return false;
	if (!isWorkerStage(value.stage) || !isWorkerOutcome(value.lastOutcome)) {
		return false;
	}
	if (!isNullableNonNegativeInteger(value.bytesDownloaded)) return false;
	if (!isNullablePositiveInteger(value.claimAttempt)) return false;
	if (!isNullableDateTime(value.lastOutcomeAt)) return false;
	if (!isCurrentObject(value.currentObject)) return false;
	if ((value.lastOutcome === 'none') !== (value.lastOutcomeAt === null)) {
		return false;
	}

	if (value.currentObject === null) {
		return (
			value.stage === 'idle' &&
			value.bytesDownloaded === null &&
			value.claimAttempt === null
		);
	}

	return value.stage !== 'idle' && value.claimAttempt !== null;
}

function isCurrentObject(
	value: unknown
): value is HistoryArchiveWorkerObjectDTO | null {
	if (value === null) return true;
	if (!isRecord(value)) return false;
	if (!hasOnlyKeys(value, ['remoteId', 'source', 'type'])) return false;

	return (
		uuidPattern.test(readString(value.remoteId)) &&
		isObjectType(value.type) &&
		isSafeArchiveSource(value.source)
	);
}

function isSafeArchiveSource(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
		return false;
	}

	try {
		const url = new URL(value);
		return (
			(url.protocol === 'http:' || url.protocol === 'https:') &&
			url.username === '' &&
			url.password === ''
		);
	} catch {
		return false;
	}
}

function isObjectType(value: unknown): value is HistoryArchiveObjectTypeDTO {
	return includesString(historyArchiveObjectTypes, value);
}

function isWorkerStage(value: unknown): value is HistoryArchiveWorkerStageDTO {
	return includesString(historyArchiveWorkerStages, value);
}

function isWorkerOutcome(
	value: unknown
): value is HistoryArchiveWorkerOutcomeDTO {
	return includesString(historyArchiveWorkerOutcomes, value);
}

function includesString(
	values: readonly string[],
	value: unknown
): value is string {
	return typeof value === 'string' && values.includes(value);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
	return value === null || isPositiveInteger(value);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
	return value === null || isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isDateTime(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableDateTime(value: unknown): value is string | null {
	return value === null || isDateTime(value);
}

function readString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
	value: Record<string, unknown>,
	allowedKeys: readonly string[]
): boolean {
	return Object.keys(value).every((key) => allowedKeys.includes(key));
}
