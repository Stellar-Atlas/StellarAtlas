import { xdr } from '@stellar/stellar-sdk';
import type { FullHistoryTransactionInput } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { decodeStellarFullHistoryOperationResults } from '../StellarFullHistoryOperationResultDecoder.js';

describe('StellarFullHistoryOperationResultDecoder', () => {
	it('decodes applied success/failure codes and marks omitted operations not applied', () => {
		const result = xdr.TransactionResult.fromXDR(
			new xdr.TransactionResult({
				ext: new xdr.TransactionResultExt(0),
				feeCharged: xdr.Int64.fromString('100'),
				result: xdr.TransactionResultResult.txFailed([
					xdr.OperationResult.opInner(
						xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess())
					),
					xdr.OperationResult.opBadAuth(),
					xdr.OperationResult.opInner(
						xdr.OperationResultTr.payment(
							xdr.PaymentResult.paymentUnderfunded()
						)
					)
				])
			}).toXDR()
		);

		expect(
			decodeStellarFullHistoryOperationResults(result, transaction(4))
		).toEqual([
			expect.objectContaining({
				operationIndex: 0,
				operationResultCode: 0,
				operationSpecificResultCode: 0,
				outcome: 'succeeded'
			}),
			expect.objectContaining({
				operationIndex: 1,
				operationResultCode: -1,
				operationSpecificResultCode: null,
				outcome: 'failed'
			}),
			expect.objectContaining({
				operationIndex: 2,
				operationResultCode: 0,
				operationSpecificResultCode: -2,
				outcome: 'failed'
			}),
			expect.objectContaining({
				factScope: 'transaction_result_xdr',
				operationIndex: 3,
				operationResultCode: null,
				operationSpecificResultCode: null,
				outcome: 'not_applied'
			})
		]);
	});

	it('marks every operation not applied when the transaction has no operation results', () => {
		const result = new xdr.TransactionResult({
			ext: new xdr.TransactionResultExt(0),
			feeCharged: xdr.Int64.fromString('100'),
			result: xdr.TransactionResultResult.txBadSeq()
		});

		expect(
			decodeStellarFullHistoryOperationResults(result, transaction(2))
		).toEqual([
			expect.objectContaining({
				operationIndex: 0,
				operationResultCode: null,
				outcome: 'not_applied'
			}),
			expect.objectContaining({
				operationIndex: 1,
				operationResultCode: null,
				outcome: 'not_applied'
			})
		]);
	});
});

function transaction(operationCount: number): FullHistoryTransactionInput {
	return {
		envelopeType: 'tx',
		feeBid: fullHistoryUint64('100'),
		ledgerSequence: fullHistoryLedgerSequence('1'),
		operationCount,
		sourceAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		sourceAccountSequence: fullHistoryUint64('1'),
		transactionHash: FullHistoryHash.fromHex('01'.repeat(32)),
		transactionIndex: 0
	};
}
