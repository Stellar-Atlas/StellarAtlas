import {
	encodeMuxedAccount,
	encodeMuxedAccountToAddress,
	StrKey
} from '@stellar/stellar-sdk';
import {
	FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
	fullHistoryOperationAccountReference
} from '../../../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	parseOperationAccountReferences,
	serializeOperationAccountReferences
} from '../FullHistoryOperationWorkerAccountReferenceCodec.js';

describe('FullHistoryOperationWorkerAccountReferenceCodec', () => {
	it('round-trips exact muxed identity and normalized base identity', () => {
		const baseAccountId = account(31);
		const accountId = encodeMuxedAccountToAddress(
			encodeMuxedAccount(baseAccountId, '42')
		);
		const transactionHash = FullHistoryHash.fromHex('ab'.repeat(32));
		const reference = fullHistoryOperationAccountReference(
			{
				ledgerSequence: fullHistoryLedgerSequence(64n),
				operationIndex: 2,
				transactionHash,
				transactionIndex: 3
			},
			'destination',
			accountId
		);

		const parsed = parseOperationAccountReferences(
			serializeOperationAccountReferences([reference])
		);

		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({
			accountId,
			baseAccountId,
			factScope: FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
			ledgerSequence: '64',
			operationIndex: 2,
			role: 'destination',
			transactionIndex: 3
		});
		expect(parsed[0]!.transactionHash.toHex()).toBe(transactionHash.toHex());
	});

	it('rejects a wire reference whose base identity does not match its account', () => {
		const accountId = account(32);
		expect(() =>
			parseOperationAccountReferences([
				{
					accountId,
					baseAccountId: account(33),
					factScope: FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
					ledgerSequence: '64',
					operationIndex: 0,
					role: 'effective_source',
					transactionHash: 'cd'.repeat(32),
					transactionIndex: 0
				}
			])
		).toThrow('baseAccountId does not match accountId');
	});
});

function account(seed: number): string {
	return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
}
