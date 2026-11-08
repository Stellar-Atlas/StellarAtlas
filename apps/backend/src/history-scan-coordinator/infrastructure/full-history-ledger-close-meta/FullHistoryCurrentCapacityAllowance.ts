const maximumLedger = 0xffff_ffff;
const maximumConfiguredReserveBorrowBytes = 1024n ** 4n;
const maximumAllowanceLifetimeMilliseconds = 6 * 60 * 60 * 1_000;

const minimumLedgerEnvironmentKey =
	'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_MIN_LEDGER';
const reserveBorrowBytesEnvironmentKey =
	'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_RESERVE_BORROW_BYTES';
const expiresAtEnvironmentKey =
	'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_EXPIRES_AT';

export interface FullHistoryCurrentCapacityAllowance {
	readonly minimumLedger: number;
	readonly maximumReserveBorrowBytes: bigint;
	readonly expiresAtMilliseconds: number;
}

export function parseFullHistoryCurrentCapacityAllowance(
	environment: NodeJS.ProcessEnv,
	nowMilliseconds = Date.now()
): FullHistoryCurrentCapacityAllowance | undefined {
	assertClock(nowMilliseconds);
	const minimumLedgerValue = environment[minimumLedgerEnvironmentKey];
	const reserveBorrowBytesValue = environment[reserveBorrowBytesEnvironmentKey];
	const expiresAtValue = environment[expiresAtEnvironmentKey];
	const values = [minimumLedgerValue, reserveBorrowBytesValue, expiresAtValue];
	if (values.every((value) => value === undefined)) return undefined;
	if (values.some((value) => value === undefined || value.trim() === '')) {
		throw new TypeError('Current-capacity allowance must be fully configured');
	}

	const minimumLedger = parsePositiveDecimalNumber(
		minimumLedgerValue!,
		maximumLedger,
		minimumLedgerEnvironmentKey
	);
	const maximumReserveBorrowBytes = parsePositiveDecimalBigInt(
		reserveBorrowBytesValue!,
		maximumConfiguredReserveBorrowBytes,
		reserveBorrowBytesEnvironmentKey
	);
	const expiresAtMilliseconds = parseCanonicalUtcExpiry(expiresAtValue!);
	if (
		expiresAtMilliseconds > nowMilliseconds + maximumAllowanceLifetimeMilliseconds
	) {
		throw new RangeError('Current-capacity allowance may expire at most 6 hours ahead');
	}

	return Object.freeze({
		minimumLedger,
		maximumReserveBorrowBytes,
		expiresAtMilliseconds
	});
}

export function isFullHistoryCurrentCapacityAllowanceActive(
	allowance: FullHistoryCurrentCapacityAllowance | undefined,
	nowMilliseconds: number
): boolean {
	assertClock(nowMilliseconds);
	return allowance !== undefined && nowMilliseconds < allowance.expiresAtMilliseconds;
}

function parsePositiveDecimalNumber(value: string, maximum: number, field: string): number {
	if (value.length > 10 || !/^[1-9][0-9]*$/u.test(value)) {
		throw new TypeError(`${field} must be a positive decimal integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed > maximum) {
		throw new RangeError(`${field} is outside its supported range`);
	}
	return parsed;
}

function parsePositiveDecimalBigInt(
	value: string,
	maximum: bigint,
	field: string
): bigint {
	if (value.length > 13 || !/^[1-9][0-9]*$/u.test(value)) {
		throw new TypeError(`${field} must be a positive decimal integer`);
	}
	const parsed = BigInt(value);
	if (parsed > maximum) throw new RangeError(`${field} is outside its supported range`);
	return parsed;
}

function parseCanonicalUtcExpiry(value: string): number {
	const parsed = Date.parse(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0 || new Date(parsed).toISOString() !== value) {
		throw new TypeError(`${expiresAtEnvironmentKey} must be a canonical UTC ISO timestamp`);
	}
	return parsed;
}

function assertClock(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('nowMilliseconds must be a non-negative safe integer');
	}
}
