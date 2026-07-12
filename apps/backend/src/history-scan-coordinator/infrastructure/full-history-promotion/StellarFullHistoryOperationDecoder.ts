import {
	FeeBumpTransaction,
	Transaction,
	type OperationRecord,
	type OperationType
} from '@stellar/stellar-sdk';
import type { FullHistoryTransactionInput } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	FULL_HISTORY_OPERATION_FACT_SCOPE,
	type FullHistoryOperationInput,
	type FullHistoryOperationType
} from '../../domain/full-history/FullHistoryCanonicalOperation.js';

const operationTypeBySdkType = {
	accountMerge: 'account_merge',
	allowTrust: 'allow_trust',
	beginSponsoringFutureReserves: 'begin_sponsoring_future_reserves',
	bumpSequence: 'bump_sequence',
	changeTrust: 'change_trust',
	claimClaimableBalance: 'claim_claimable_balance',
	clawback: 'clawback',
	clawbackClaimableBalance: 'clawback_claimable_balance',
	createAccount: 'create_account',
	createClaimableBalance: 'create_claimable_balance',
	createPassiveSellOffer: 'create_passive_sell_offer',
	endSponsoringFutureReserves: 'end_sponsoring_future_reserves',
	extendFootprintTtl: 'extend_footprint_ttl',
	inflation: 'inflation',
	invokeHostFunction: 'invoke_host_function',
	liquidityPoolDeposit: 'liquidity_pool_deposit',
	liquidityPoolWithdraw: 'liquidity_pool_withdraw',
	manageBuyOffer: 'manage_buy_offer',
	manageData: 'manage_data',
	manageSellOffer: 'manage_sell_offer',
	pathPaymentStrictReceive: 'path_payment_strict_receive',
	pathPaymentStrictSend: 'path_payment_strict_send',
	payment: 'payment',
	restoreFootprint: 'restore_footprint',
	revokeAccountSponsorship: 'revoke_sponsorship',
	revokeClaimableBalanceSponsorship: 'revoke_sponsorship',
	revokeDataSponsorship: 'revoke_sponsorship',
	revokeLiquidityPoolSponsorship: 'revoke_sponsorship',
	revokeOfferSponsorship: 'revoke_sponsorship',
	revokeSignerSponsorship: 'revoke_sponsorship',
	revokeTrustlineSponsorship: 'revoke_sponsorship',
	setOptions: 'set_options',
	setTrustLineFlags: 'set_trust_line_flags'
} satisfies Readonly<Record<OperationType, FullHistoryOperationType>>;

export const STELLAR_FULL_HISTORY_OPERATION_DECODER_VERSION =
	'stellar-sdk-16/archive-xdr-v2-operation-facts';

export function decodeStellarFullHistoryOperations(
	sdkTransaction: FeeBumpTransaction | Transaction,
	canonicalTransaction: FullHistoryTransactionInput
): FullHistoryOperationInput[] {
	const transaction =
		sdkTransaction instanceof FeeBumpTransaction
			? sdkTransaction.innerTransaction
			: sdkTransaction;
	return transaction.operations.map((operation, operationIndex) =>
		decodeOperation(
			operation,
			operationIndex,
			transaction.source,
			canonicalTransaction
		)
	);
}

function decodeOperation(
	operation: OperationRecord,
	operationIndex: number,
	transactionSource: string,
	canonicalTransaction: FullHistoryTransactionInput
): FullHistoryOperationInput {
	const operationSource = operation.source;
	return {
		factScope: FULL_HISTORY_OPERATION_FACT_SCOPE,
		ledgerSequence: canonicalTransaction.ledgerSequence,
		operationIndex,
		operationType: operationTypeBySdkType[operation.type],
		sourceAccount: operationSource ?? transactionSource,
		sourceAccountOrigin:
			operationSource === undefined ? 'transaction' : 'operation',
		transactionHash: canonicalTransaction.transactionHash,
		transactionIndex: canonicalTransaction.transactionIndex
	};
}
