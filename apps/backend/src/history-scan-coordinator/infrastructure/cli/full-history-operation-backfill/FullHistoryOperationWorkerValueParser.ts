import {
	assertInteger,
	assertValidDate,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

export function readWorkerRecord(
	value: unknown,
	field: string
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${field} must be a record`);
	}
	return value as Record<string, unknown>;
}

export function readWorkerArray(
	value: unknown,
	field: string,
	maximumLength: number
): readonly unknown[] {
	if (!Array.isArray(value) || value.length > maximumLength) {
		throw new RangeError(`${field} must be a bounded array`);
	}
	return value;
}

export function readWorkerString(
	value: unknown,
	field: string,
	maximumBytes: number
): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		Buffer.byteLength(value) > maximumBytes
	) {
		throw new TypeError(`${field} must be a bounded non-empty string`);
	}
	return value;
}

export function readWorkerInteger(
	value: unknown,
	field: string,
	minimum: number,
	maximum = 0x7fff_ffff
): number {
	if (typeof value !== 'number') {
		throw new TypeError(`${field} must be an integer`);
	}
	return assertInteger(value, field, minimum, maximum);
}

export function readWorkerBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		throw new TypeError(`${field} must be a boolean`);
	}
	return value;
}

export function readWorkerDate(value: unknown, field: string): Date {
	const serialized = readWorkerString(value, field, 64);
	return assertValidDate(new Date(serialized), field);
}

export function readWorkerHash(value: unknown, field: string): FullHistoryHash {
	return FullHistoryHash.fromHex(readWorkerString(value, field, 64));
}
