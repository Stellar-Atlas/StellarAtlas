export type FullHistoryPromotionErrorReason =
	| 'candidate-incomplete'
	| 'category-hash-mismatch'
	| 'envelope-hash-mismatch'
	| 'invalid-network-passphrase'
	| 'invalid-proof'
	| 'invalid-source-evidence'
	| 'ledger-range-mismatch'
	| 'transaction-pairing-mismatch'
	| 'xdr-bound-exceeded'
	| 'xdr-decode-failed';

export class FullHistoryPromotionError extends Error {
	readonly name = 'FullHistoryPromotionError';

	constructor(
		readonly reason: FullHistoryPromotionErrorReason,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
	}
}
export interface FullHistoryLedgerObservationCount {
	readonly checkpointLedger: number;
	readonly ledgerObjectRemoteId: string;
	readonly expectedLedgerCount: number;
	readonly observedLedgerCount: number;
}

export class FullHistoryLedgerObservationsMissingError extends FullHistoryPromotionError {
	constructor(readonly diagnostic: FullHistoryLedgerObservationCount) {
		super(
			'candidate-incomplete',
			'Exact checkpoint ledger observations are incomplete'
		);
	}
}
