import {
	historyArchiveObjectTypes,
	historyArchiveWorkerOutcomes,
	historyArchiveWorkerStages,
	type HistoryArchiveObjectTypeDTO,
	type HistoryArchiveWorkerOutcomeDTO,
	type HistoryArchiveWorkerStageDTO
} from 'history-scanner-dto';

export function encodeHistoryArchiveObjectType(
	value: HistoryArchiveObjectTypeDTO | null
): number | null {
	return value === null ? null : historyArchiveObjectTypes.indexOf(value) + 1;
}

export function decodeHistoryArchiveObjectType(
	value: unknown
): HistoryArchiveObjectTypeDTO | null {
	if (value === null) return null;
	return decodeCode(historyArchiveObjectTypes, value, 1, 'object type');
}

export function encodeHistoryArchiveWorkerStage(
	value: HistoryArchiveWorkerStageDTO
): number {
	return historyArchiveWorkerStages.indexOf(value);
}

export function decodeHistoryArchiveWorkerStage(
	value: unknown
): HistoryArchiveWorkerStageDTO {
	return decodeCode(historyArchiveWorkerStages, value, 0, 'worker stage');
}

export function encodeHistoryArchiveWorkerOutcome(
	value: HistoryArchiveWorkerOutcomeDTO
): number {
	return historyArchiveWorkerOutcomes.indexOf(value);
}

export function decodeHistoryArchiveWorkerOutcome(
	value: unknown
): HistoryArchiveWorkerOutcomeDTO {
	return decodeCode(historyArchiveWorkerOutcomes, value, 0, 'worker outcome');
}

function decodeCode<const T extends readonly string[]>(
	values: T,
	value: unknown,
	offset: number,
	label: string
): T[number] {
	const code = Number(value);
	const decoded = values[code - offset];
	if (!Number.isInteger(code) || decoded === undefined) {
		throw new Error(`Invalid history archive ${label} code`);
	}

	return decoded;
}
