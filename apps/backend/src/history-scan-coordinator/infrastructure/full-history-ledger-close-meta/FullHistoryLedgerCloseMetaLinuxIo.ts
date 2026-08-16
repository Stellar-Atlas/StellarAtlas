import { readFile } from 'node:fs/promises';

const linuxIoPressurePath = '/proc/pressure/io';
const md0InflightPath = '/sys/block/md0/inflight';

export interface FullHistoryLedgerCloseMetaLinuxIoSnapshot {
	readonly ioFullPressureBasisPoints: number;
	readonly ioSomePressureBasisPoints: number;
	readonly md0InflightRequests: number;
}

export type FullHistoryLedgerCloseMetaLinuxIoReader = (
	signal: AbortSignal
) => Promise<FullHistoryLedgerCloseMetaLinuxIoSnapshot>;

export interface FullHistoryLedgerCloseMetaLinuxIoReaderOptions {
	readonly readIoPressure?: (signal: AbortSignal) => Promise<string>;
	readonly readMd0Inflight?: (signal: AbortSignal) => Promise<string>;
}

export function createFullHistoryLedgerCloseMetaLinuxIoReader(
	options: FullHistoryLedgerCloseMetaLinuxIoReaderOptions = {}
): FullHistoryLedgerCloseMetaLinuxIoReader {
	const readIoPressure = options.readIoPressure ?? readLinuxIoPressure;
	const readMd0Inflight = options.readMd0Inflight ?? readLinuxMd0Inflight;
	return async (signal) => {
		signal.throwIfAborted();
		const [pressure, inflight] = await Promise.all([
			readIoPressure(signal),
			readMd0Inflight(signal)
		]);
		signal.throwIfAborted();
		const ioPressure = parseFullHistoryLedgerCloseMetaLinuxIoPressure(pressure);
		return Object.freeze({
			ioFullPressureBasisPoints: ioPressure.full,
			ioSomePressureBasisPoints: ioPressure.some,
			md0InflightRequests: parseFullHistoryLedgerCloseMetaMd0Inflight(inflight)
		});
	};
}

export function parseFullHistoryLedgerCloseMetaLinuxIoPressure(value: string): {
	readonly full: number;
	readonly some: number;
} {
	const lines = new Map(
		value
			.trim()
			.split(/\r?\n/u)
			.map((line) => [line.split(/\s+/u, 1)[0], line] as const)
	);
	return {
		full: pressureBasisPoints(lines.get('full'), 'full'),
		some: pressureBasisPoints(lines.get('some'), 'some')
	};
}

export function parseFullHistoryLedgerCloseMetaMd0Inflight(
	value: string
): number {
	const fields = value.trim().split(/\s+/u);
	if (fields.length !== 2 || fields.some((field) => !/^[0-9]+$/u.test(field))) {
		throw new Error('Linux md0 in-flight counters are unavailable');
	}
	const readRequests = Number(fields[0]);
	const writeRequests = Number(fields[1]);
	const totalRequests = readRequests + writeRequests;
	if (
		!Number.isSafeInteger(readRequests) ||
		!Number.isSafeInteger(writeRequests) ||
		!Number.isSafeInteger(totalRequests)
	) {
		throw new Error('Linux md0 in-flight counters are invalid');
	}
	return totalRequests;
}

async function readLinuxIoPressure(signal: AbortSignal): Promise<string> {
	return readFile(linuxIoPressurePath, { encoding: 'utf8', signal });
}

async function readLinuxMd0Inflight(signal: AbortSignal): Promise<string> {
	return readFile(md0InflightPath, { encoding: 'utf8', signal });
}

function pressureBasisPoints(
	line: string | undefined,
	category: 'full' | 'some'
): number {
	const match = line?.match(/(?:^|\s)avg10=([0-9]+(?:\.[0-9]+)?)(?:\s|$)/u);
	if (match === undefined || match === null) {
		throw new Error(`Linux I/O PSI ${category} avg10 is unavailable`);
	}
	const basisPoints = Math.round(Number(match[1]) * 100);
	if (
		!Number.isSafeInteger(basisPoints) ||
		basisPoints < 0 ||
		basisPoints > 10_000
	) {
		throw new RangeError(
			`Linux I/O PSI ${category} avg10 must be between 0 and 10000 basis points`
		);
	}
	return basisPoints;
}
