import { StrKey } from '@stellar/stellar-sdk';
import type {
	BoundExactClassicObservation,
	ExactClassicSelection,
	ExactObservationImport
} from '../ExactClassicObservation.js';

export const networkHash = 'a'.repeat(64),
	sourceDigest = 'b'.repeat(64);
export const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
export const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
export const batchId = '00000000-0000-0000-0000-000000000001';
export const source: ExactObservationImport = {
	batchId,
	networkHash,
	sourceDigest,
	verifiedSourceDigest: sourceDigest,
	status: 'complete',
	visibility: 'visible',
	firstLedger: '1',
	lastLedger: '100'
};
export const row = (
	values: Partial<BoundExactClassicObservation> = {}
): BoundExactClassicObservation => ({
	networkHash,
	account,
	asset: { kind: 'native' },
	batchId,
	sourceDigest,
	rowDigest: 'c'.repeat(64),
	ledgerSequence: '50',
	transactionIndex: '1',
	changeIndex: '1',
	reason: 'transaction',
	operationIndex: null,
	upgradeIndex: null,
	changeKind: 'updated',
	deleted: false,
	balanceRaw: '9223372036854775807',
	buyingLiabilitiesRaw: '9007199254740993',
	sellingLiabilitiesRaw: '0',
	...values
});
export const selection = (
	rows: readonly BoundExactClassicObservation[] = [row()]
): ExactClassicSelection => ({
	scope: {
		networkHash,
		account,
		asset: { kind: 'native' },
		firstLedger: '1',
		lastLedger: '100'
	},
	coverage: {
		status: 'complete',
		truncated: false,
		expectedDistinctObservations: rows.length
	},
	imports: [source],
	observations: rows
});
