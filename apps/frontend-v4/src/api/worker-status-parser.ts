import type {
	ArchiveWorkerOutcomeDTO,
	ArchiveWorkerStageDTO,
	ArchiveWorkerStatusRowDTO,
	PublicHistoryArchiveObjectType,
	PublicStatusLevel,
	WorkerStatusDTO
} from './types';

const stages = new Set<ArchiveWorkerStageDTO>([
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
]);
const outcomes = new Set<ArchiveWorkerOutcomeDTO>([
	'none',
	'verified',
	'archive_error',
	'worker_issue',
	'released'
]);
const objectTypes = new Set([
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
]);
const rowStates = new Set(['active', 'idle', 'stale'] as const);
const statusLevels = new Set<PublicStatusLevel>([
	'ok',
	'degraded',
	'unavailable'
]);
const archiveWorkerSlotCount = 24;

const perWorkerNumericFields = [
	'activeWorkers',
	'configuredWorkerProcesses',
	'freshWorkers',
	'idleWorkers',
	'missingWorkers',
	'queueActiveWorkers',
	'queueStaleWorkers',
	'registeredWorkers',
	'staleJobAgeMs',
	'staleWorkers',
	'startupGraceMs',
	'totalTakenJobs'
] as const;

const legacyNumericFields = [
	'activeWorkers',
	'configuredWorkerProcesses',
	'staleJobAgeMs',
	'staleWorkers',
	'totalTakenJobs'
] as const;

export function parseWorkerStatusDTO(value: unknown): WorkerStatusDTO | null {
	if (!isRecord(value)) return null;
	if (!isDateTime(value.generatedAt) || !isStatus(value.status)) return null;
	const community = parseCommunity(value.communityScanners);
	if (community === null || !isRecord(value.archiveWorkers)) return null;

	const archive = hasPerWorkerFields(value.archiveWorkers)
		? parsePerWorkerArchive(value.archiveWorkers)
		: parseLegacyArchive(value.archiveWorkers);
	if (archive === null) return null;

	return {
		archiveWorkers: archive,
		communityScanners: community,
		generatedAt: value.generatedAt,
		status: value.status
	};
}

function hasPerWorkerFields(value: Record<string, unknown>): boolean {
	return (
		Object.hasOwn(value, 'workers') ||
		Object.hasOwn(value, 'freshWorkers') ||
		Object.hasOwn(value, 'telemetryMode')
	);
}

function parsePerWorkerArchive(
	value: Record<string, unknown>
): WorkerStatusDTO['archiveWorkers'] | null {
	const numbers = readNumbers(value, perWorkerNumericFields);
	if (
		numbers === null ||
		!isStatus(value.status) ||
		typeof value.startupGraceActive !== 'boolean' ||
		!isNullableDateTime(value.lastHeartbeatAt) ||
		!Array.isArray(value.workers) ||
		value.workers.length > archiveWorkerSlotCount ||
		(value.telemetryMode !== undefined && value.telemetryMode !== 'per-worker')
	) {
		return null;
	}

	const workers: ArchiveWorkerStatusRowDTO[] = [];
	for (const candidate of value.workers) {
		const worker = parseWorkerRow(candidate);
		if (worker === null) return null;
		workers.push(worker);
	}
	workers.sort((left, right) => left.slotIndex - right.slotIndex);

	return {
		...numbers,
		lastHeartbeatAt: value.lastHeartbeatAt,
		startupGraceActive: value.startupGraceActive,
		status: value.status,
		telemetryMode: 'per-worker',
		workers
	};
}

function parseLegacyArchive(
	value: Record<string, unknown>
): WorkerStatusDTO['archiveWorkers'] | null {
	const numbers = readNumbers(value, legacyNumericFields);
	if (numbers === null || !isStatus(value.status)) return null;
	const activeWorkers = numbers.activeWorkers;
	const configuredWorkerProcesses = numbers.configuredWorkerProcesses;
	const staleWorkers = numbers.staleWorkers;

	return {
		activeWorkers,
		configuredWorkerProcesses,
		freshWorkers: activeWorkers,
		idleWorkers: 0,
		lastHeartbeatAt: null,
		missingWorkers: Math.max(configuredWorkerProcesses - activeWorkers, 0),
		queueActiveWorkers: activeWorkers,
		queueStaleWorkers: staleWorkers,
		registeredWorkers: activeWorkers,
		staleJobAgeMs: numbers.staleJobAgeMs,
		staleWorkers,
		startupGraceActive: false,
		startupGraceMs: numbers.staleJobAgeMs,
		status: value.status,
		telemetryMode: 'aggregate-only',
		totalTakenJobs: numbers.totalTakenJobs,
		workers: []
	};
}

function parseWorkerRow(value: unknown): ArchiveWorkerStatusRowDTO | null {
	if (!isRecord(value)) return null;
	const currentObject = parseCurrentObject(value.currentObject);
	if (currentObject === undefined) return null;
	if (
		!isNullableNonNegativeInteger(value.bytesDownloaded) ||
		(value.bytesTotal !== undefined &&
			!isNullableNonNegativeInteger(value.bytesTotal)) ||
		!isNullablePositiveInteger(value.claimAttempt) ||
		!isNonNegativeInteger(value.heartbeatAgeMs) ||
		!isDateTime(value.lastHeartbeatAt) ||
		!isOutcome(value.lastOutcome) ||
		!isNullableDateTime(value.lastOutcomeAt) ||
		!isPositiveInteger(value.pid) ||
		!isNonNegativeInteger(value.processGeneration) ||
		!isUuid(value.processId) ||
		!isDateTime(value.processStartedAt) ||
		!isWorkerSlotIndex(value.slotIndex) ||
		!isStage(value.stage) ||
		typeof value.status !== 'string' ||
		!rowStates.has(value.status as 'active' | 'idle' | 'stale') ||
		typeof value.workerId !== 'string' ||
		value.workerId.length === 0 ||
		value.workerId.length > 96
	) {
		return null;
	}

	return {
		bytesDownloaded: value.bytesDownloaded,
		bytesTotal: value.bytesTotal ?? null,
		claimAttempt: value.claimAttempt,
		currentObject,
		heartbeatAgeMs: value.heartbeatAgeMs,
		lastHeartbeatAt: value.lastHeartbeatAt,
		lastOutcome: value.lastOutcome,
		lastOutcomeAt: value.lastOutcomeAt,
		pid: value.pid,
		processGeneration: value.processGeneration,
		processId: value.processId,
		processStartedAt: value.processStartedAt,
		slotIndex: value.slotIndex,
		stage: value.stage,
		status: value.status as 'active' | 'idle' | 'stale',
		workerId: value.workerId
	};
}

function parseCurrentObject(
	value: unknown
): ArchiveWorkerStatusRowDTO['currentObject'] | undefined {
	if (value === null) return null;
	if (
		!isRecord(value) ||
		!isUuid(value.remoteId) ||
		typeof value.type !== 'string' ||
		!objectTypes.has(value.type) ||
		!isPublicArchiveSource(value.source)
	) {
		return undefined;
	}

	return {
		remoteId: value.remoteId,
		source: value.source,
		type: value.type as PublicHistoryArchiveObjectType
	};
}

function parseCommunity(
	value: unknown
): WorkerStatusDTO['communityScanners'] | null {
	if (!isRecord(value) || !isStatus(value.status)) return null;
	const numbers = readNumbers(value, [
		'activeScanners',
		'blacklistedScanners',
		'degradedScanners',
		'heartbeatFreshnessMs',
		'offlineScanners',
		'totalScanners'
	] as const);
	return numbers === null ? null : { ...numbers, status: value.status };
}

function readNumbers<const K extends readonly string[]>(
	value: Record<string, unknown>,
	fields: K
): Readonly<Record<K[number], number>> | null {
	const numbers: Partial<Record<K[number], number>> = {};
	for (const field of fields) {
		const candidate = value[field];
		if (!isNonNegativeInteger(candidate)) return null;
		numbers[field as K[number]] = candidate;
	}
	return numbers as Readonly<Record<K[number], number>>;
}

function isPublicArchiveSource(value: unknown): value is string {
	if (value === 'redacted') return true;
	if (typeof value !== 'string' || value.length > 512) return false;
	try {
		const url = new URL(value);
		return (
			(url.protocol === 'http:' || url.protocol === 'https:') &&
			url.username === '' &&
			url.password === '' &&
			value === url.origin
		);
	} catch {
		return false;
	}
}

function isStage(value: unknown): value is ArchiveWorkerStageDTO {
	return (
		typeof value === 'string' && stages.has(value as ArchiveWorkerStageDTO)
	);
}

function isOutcome(value: unknown): value is ArchiveWorkerOutcomeDTO {
	return (
		typeof value === 'string' && outcomes.has(value as ArchiveWorkerOutcomeDTO)
	);
}

function isStatus(value: unknown): value is PublicStatusLevel {
	return (
		typeof value === 'string' && statusLevels.has(value as PublicStatusLevel)
	);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isWorkerSlotIndex(value: unknown): value is number {
	return isNonNegativeInteger(value) && value < archiveWorkerSlotCount;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
	return value === null || isPositiveInteger(value);
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
	return value === null || isNonNegativeInteger(value);
}

function isDateTime(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableDateTime(value: unknown): value is string | null {
	return value === null || isDateTime(value);
}

function isUuid(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
