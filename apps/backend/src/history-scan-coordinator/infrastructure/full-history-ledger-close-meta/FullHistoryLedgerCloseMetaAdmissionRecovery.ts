export type FullHistoryLedgerCloseMetaAdmissionReason =
	| 'database-connection-pressure'
	| 'database-probe-latency'
	| 'io-full-pressure'
	| 'io-some-pressure'
	| 'md0-inflight-pressure'
	| 'recovery-hysteresis';

export interface FullHistoryLedgerCloseMetaAdmissionSnapshot {
	readonly databaseConnectionBasisPoints: number;
	readonly databaseProbeMilliseconds: number;
	readonly ioFullPressureBasisPoints: number;
	readonly ioSomePressureBasisPoints: number;
	readonly md0InflightRequests: number;
	readonly recoveryHealthySamples: number;
	readonly recoveryHealthySamplesRequired: number;
}

export type FullHistoryLedgerCloseMetaAdmissionDecision =
	| {
			readonly admitted: true;
			readonly snapshot?: FullHistoryLedgerCloseMetaAdmissionSnapshot;
	  }
	| {
			readonly admitted: false;
			readonly reasons: readonly FullHistoryLedgerCloseMetaAdmissionReason[];
			readonly snapshot: FullHistoryLedgerCloseMetaAdmissionSnapshot;
	  };

export interface FullHistoryLedgerCloseMetaAdmissionPressureValues {
	readonly databaseConnectionBasisPoints: number;
	readonly databaseProbeMilliseconds: number;
	readonly ioFullPressureBasisPoints: number;
	readonly ioSomePressureBasisPoints: number;
	readonly md0InflightRequests: number;
}

export interface FullHistoryLedgerCloseMetaAdmissionRecoveryOptions {
	readonly maximumDatabaseConnectionBasisPoints: number;
	readonly maximumDatabaseProbeMilliseconds: number;
	readonly maximumIoFullPressureBasisPoints: number;
	readonly maximumIoSomePressureBasisPoints: number;
	readonly maximumMd0InflightRequests: number;
	readonly recoveryHealthySamplesRequired: number;
}

export class FullHistoryLedgerCloseMetaAdmissionRecovery {
	readonly #options: FullHistoryLedgerCloseMetaAdmissionRecoveryOptions;
	#consecutiveHealthySamples = 0;
	#recoveryRequired = false;

	constructor(options: FullHistoryLedgerCloseMetaAdmissionRecoveryOptions) {
		assertBasisPoints(
			options.maximumDatabaseConnectionBasisPoints,
			'maximumDatabaseConnectionBasisPoints'
		);
		assertPositiveInteger(
			options.maximumDatabaseProbeMilliseconds,
			'maximumDatabaseProbeMilliseconds'
		);
		assertBasisPoints(
			options.maximumIoFullPressureBasisPoints,
			'maximumIoFullPressureBasisPoints'
		);
		assertBasisPoints(
			options.maximumIoSomePressureBasisPoints,
			'maximumIoSomePressureBasisPoints'
		);
		if (
			options.maximumIoFullPressureBasisPoints >
			options.maximumIoSomePressureBasisPoints
		) {
			throw new RangeError(
				'maximumIoFullPressureBasisPoints cannot exceed maximumIoSomePressureBasisPoints'
			);
		}
		assertNonNegativeInteger(
			options.maximumMd0InflightRequests,
			'maximumMd0InflightRequests'
		);
		assertPositiveInteger(
			options.recoveryHealthySamplesRequired,
			'recoveryHealthySamplesRequired'
		);
		this.#options = options;
	}

	evaluate(
		values: FullHistoryLedgerCloseMetaAdmissionPressureValues
	): FullHistoryLedgerCloseMetaAdmissionDecision {
		const reasons = this.#pressureReasons(values);
		if (reasons.length > 0) {
			this.failClosed();
			return deferredDecision(reasons, this.#snapshot(values, 0));
		}
		if (!this.#recoveryRequired) {
			return Object.freeze({
				admitted: true,
				snapshot: this.#snapshot(values, 0)
			});
		}

		this.#consecutiveHealthySamples += 1;
		const snapshot = this.#snapshot(values, this.#consecutiveHealthySamples);
		if (
			this.#consecutiveHealthySamples <
			this.#options.recoveryHealthySamplesRequired
		) {
			return deferredDecision(['recovery-hysteresis'], snapshot);
		}
		this.#recoveryRequired = false;
		this.#consecutiveHealthySamples = 0;
		return Object.freeze({ admitted: true, snapshot });
	}

	failClosed(): void {
		this.#recoveryRequired = true;
		this.#consecutiveHealthySamples = 0;
	}

	#pressureReasons(
		values: FullHistoryLedgerCloseMetaAdmissionPressureValues
	): FullHistoryLedgerCloseMetaAdmissionReason[] {
		const reasons: FullHistoryLedgerCloseMetaAdmissionReason[] = [];
		if (
			values.databaseConnectionBasisPoints >
			this.#options.maximumDatabaseConnectionBasisPoints
		) {
			reasons.push('database-connection-pressure');
		}
		if (
			values.databaseProbeMilliseconds >
			this.#options.maximumDatabaseProbeMilliseconds
		) {
			reasons.push('database-probe-latency');
		}
		if (
			values.ioFullPressureBasisPoints >
			this.#options.maximumIoFullPressureBasisPoints
		) {
			reasons.push('io-full-pressure');
		}
		if (
			values.ioSomePressureBasisPoints >
			this.#options.maximumIoSomePressureBasisPoints
		) {
			reasons.push('io-some-pressure');
		}
		if (values.md0InflightRequests > this.#options.maximumMd0InflightRequests) {
			reasons.push('md0-inflight-pressure');
		}
		return reasons;
	}

	#snapshot(
		values: FullHistoryLedgerCloseMetaAdmissionPressureValues,
		recoveryHealthySamples: number
	): FullHistoryLedgerCloseMetaAdmissionSnapshot {
		return Object.freeze({
			...values,
			recoveryHealthySamples,
			recoveryHealthySamplesRequired:
				this.#options.recoveryHealthySamplesRequired
		});
	}
}

function deferredDecision(
	reasons: readonly FullHistoryLedgerCloseMetaAdmissionReason[],
	snapshot: FullHistoryLedgerCloseMetaAdmissionSnapshot
): FullHistoryLedgerCloseMetaAdmissionDecision {
	return Object.freeze({
		admitted: false,
		reasons: Object.freeze([...reasons]),
		snapshot
	});
}

function assertBasisPoints(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
		throw new RangeError(`${field} must be an integer between 0 and 10000`);
	}
}

function assertPositiveInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${field} must be a positive integer`);
	}
}

function assertNonNegativeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${field} must be a non-negative integer`);
	}
}
