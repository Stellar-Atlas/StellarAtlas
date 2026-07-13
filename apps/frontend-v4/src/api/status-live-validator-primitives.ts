export type StatusLiveValidator = (value: unknown) => boolean;

export function matches(
	required: Readonly<Record<string, StatusLiveValidator>>,
	optional: Readonly<Record<string, StatusLiveValidator>> = {}
): StatusLiveValidator {
	return (value) => {
		if (!isRecord(value)) return false;
		for (const [field, validator] of Object.entries(required)) {
			if (!Object.hasOwn(value, field) || !validator(value[field])) {
				return false;
			}
		}
		for (const [field, validator] of Object.entries(optional)) {
			if (Object.hasOwn(value, field) && !validator(value[field])) return false;
		}
		return true;
	};
}

export function arrayOf(
	validator: StatusLiveValidator,
	limit: number
): StatusLiveValidator {
	return (value) =>
		Array.isArray(value) &&
		value.length <= limit &&
		value.every((entry) => validator(entry));
}

export function nullable(validator: StatusLiveValidator): StatusLiveValidator {
	return (value) => value === null || validator(value);
}

export function oneOf(...values: readonly unknown[]): StatusLiveValidator {
	return (value) => values.includes(value);
}

export function oneOfType(
	...validators: readonly StatusLiveValidator[]
): StatusLiveValidator {
	return (value) => validators.some((validator) => validator(value));
}

export function literal(expected: unknown): StatusLiveValidator {
	return (value) => value === expected;
}

export function boolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

export function string(value: unknown): value is string {
	return typeof value === 'string';
}

export function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

export function unsignedIntegerString(value: unknown): value is string {
	return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

export function number(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

export function nonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function dateTime(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function lowercaseSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function statusLevel(value: unknown): boolean {
	return value === 'ok' || value === 'degraded' || value === 'unavailable';
}

export function uuid(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
