export type ExactClassicAsset =
	| { readonly kind: 'native' }
	| { readonly kind: 'issued'; readonly code: string; readonly issuer: string };

export interface ExactClassicScope {
	readonly networkHash: string;
	readonly account: string;
	readonly asset: ExactClassicAsset;
	readonly firstLedger: string;
	readonly lastLedger: string;
}

export type ExactChangeReason =
	'fee' | 'transaction' | 'operation' | 'fee_refund' | 'upgrade';

/** Importer assertions, not cryptographic evidence produced by this selector. */
export interface ExactObservationImport {
	readonly batchId: string;
	readonly networkHash: string;
	readonly sourceDigest: string;
	readonly verifiedSourceDigest: string | null;
	readonly status: 'complete' | 'pending' | 'failed';
	readonly visibility: 'visible' | 'hidden';
	readonly firstLedger: string;
	readonly lastLedger: string;
}

export interface BoundExactClassicObservation {
	readonly networkHash: string;
	readonly account: string;
	readonly asset: ExactClassicAsset;
	readonly batchId: string;
	readonly sourceDigest: string;
	readonly rowDigest: string;
	readonly ledgerSequence: string;
	readonly transactionIndex: string;
	readonly changeIndex: string;
	readonly reason: ExactChangeReason;
	readonly operationIndex: string | null;
	readonly upgradeIndex: string | null;
	readonly changeKind: 'created' | 'updated' | 'removed' | 'restored';
	readonly deleted: boolean;
	readonly balanceRaw: string;
	readonly buyingLiabilitiesRaw: string;
	readonly sellingLiabilitiesRaw: string;
}

export interface ExactClassicSelection {
	readonly scope: ExactClassicScope;
	readonly coverage: {
		/** Matching distinct observations in this scope, not all rows in a batch. */
		readonly expectedDistinctObservations: number | null;
		readonly status: 'complete' | 'partial' | 'unknown';
		readonly truncated: boolean;
	};
	readonly imports: readonly ExactObservationImport[];
	readonly observations: readonly BoundExactClassicObservation[];
}

export interface ExactClassicObservation {
	readonly ledgerSequence: string;
	readonly transactionIndex: string;
	readonly changeIndex: string;
	readonly reason: ExactChangeReason;
	readonly operationIndex: string | null;
	readonly upgradeIndex: string | null;
	readonly changeKind: 'created' | 'updated' | 'removed' | 'restored';
	readonly deleted: boolean;
	readonly balanceRaw: string;
	readonly buyingLiabilitiesRaw: string;
	readonly sellingLiabilitiesRaw: string;
	readonly scale: 7;
	readonly precision: 'exact-atomic-observation';
	readonly source: {
		readonly batchId: string;
		readonly sourceDigest: string;
		readonly rowDigest: string;
	};
}

export interface ExactClassicSelectionResult {
	/** No-observation is limited to the declared interval, not chain absence. */
	readonly state: 'present' | 'deleted' | 'no-observation' | 'incomplete';
	readonly scope: ExactClassicScope;
	readonly observation: ExactClassicObservation | null;
	readonly distinctObservations: number;
	readonly incompleteReasons: readonly (
		'coverage' | 'truncated' | 'count' | 'imports'
	)[];
	readonly currentChainState: false;
	readonly snapshotPinned: false;
}

export class ExactClassicObservationError extends Error {
	constructor(
		readonly code: 'invalid_input' | 'conflicting_evidence',
		message: string
	) {
		super(message);
		this.name = 'ExactClassicObservationError';
	}
}
