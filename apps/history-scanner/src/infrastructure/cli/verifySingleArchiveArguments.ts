import type { VerifySingleArchiveDTO } from '../../use-cases/verify-single-archive/VerifySingleArchiveDTO.js';

export const scanSingleArchiveUsage =
	'Usage: pnpm --filter history-scanner run scan-single-archive <historyUrl> <fromLedger> <toLedger> [concurrency]';

export function parseScanSingleArchiveArguments(
	args: string[]
): VerifySingleArchiveDTO {
	const [historyUrl, fromLedger, toLedger, concurrency, ...extraArgs] = args;
	if (extraArgs.length > 0) {
		throw new Error('Too many arguments');
	}

	if (!historyUrl || historyUrl.trim() === '') {
		throw new Error('historyUrl is required');
	}

	const parsedFromLedger = parseRequiredInteger('fromLedger', fromLedger, 0);
	const parsedToLedger = parseRequiredInteger('toLedger', toLedger, 0);
	if (parsedFromLedger >= parsedToLedger) {
		throw new Error('toLedger must be greater than fromLedger');
	}

	return {
		historyUrl,
		fromLedger: parsedFromLedger,
		toLedger: parsedToLedger,
		maxConcurrency: parseOptionalInteger('concurrency', concurrency, 1)
	};
}

function parseRequiredInteger(
	name: string,
	value: string | undefined,
	minimum: number
): number {
	if (value === undefined) {
		throw new Error(`${name} is required`);
	}

	return parseInteger(name, value, minimum);
}

function parseOptionalInteger(
	name: string,
	value: string | undefined,
	minimum: number
): number | undefined {
	if (value === undefined) return undefined;

	return parseInteger(name, value, minimum);
}

function parseInteger(name: string, value: string, minimum: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < minimum) {
		throw new Error(`${name} must be an integer >= ${minimum}`);
	}

	return parsed;
}
