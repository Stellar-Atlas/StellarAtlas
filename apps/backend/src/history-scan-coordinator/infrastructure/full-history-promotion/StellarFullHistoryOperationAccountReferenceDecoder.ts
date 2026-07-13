import {
	FeeBumpTransaction,
	Transaction,
	type OperationRecord
} from '@stellar/stellar-sdk';
import type { FullHistoryTransactionInput } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationInput } from '../../domain/full-history/FullHistoryCanonicalOperation.js';
import {
	fullHistoryOperationAccountReference,
	type FullHistoryOperationAccountReferenceInput,
	type FullHistoryOperationAccountReferenceRole
} from '../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';

export const STELLAR_FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_DECODER_VERSION =
	'stellar-sdk-16/archive-xdr-v1-operation-account-references';

interface ExplicitReference {
	readonly accountId: string;
	readonly role: FullHistoryOperationAccountReferenceRole;
}

export function decodeStellarFullHistoryOperationAccountReferences(
	sdkTransaction: FeeBumpTransaction | Transaction,
	canonicalTransaction: FullHistoryTransactionInput,
	canonicalOperations: readonly FullHistoryOperationInput[]
): FullHistoryOperationAccountReferenceInput[] {
	const transaction =
		sdkTransaction instanceof FeeBumpTransaction
			? sdkTransaction.innerTransaction
			: sdkTransaction;
	return transaction.operations.flatMap((operation, operationIndex) => {
		const canonicalOperation = canonicalOperations[operationIndex];
		if (canonicalOperation === undefined) {
			throw new Error(
				'Canonical operation account-reference position is missing'
			);
		}
		const references: ExplicitReference[] = [
			{
				accountId: operation.source ?? transaction.source,
				role: 'effective_source'
			},
			...decodeExplicitReferences(operation)
		];
		const identities = new Set<string>();
		return references.flatMap((reference) => {
			const identity = `${reference.role}:${reference.accountId}`;
			if (identities.has(identity)) return [];
			identities.add(identity);
			return [
				fullHistoryOperationAccountReference(
					canonicalOperation,
					reference.role,
					reference.accountId
				)
			];
		});
	});
}

function decodeExplicitReferences(
	operation: OperationRecord
): readonly ExplicitReference[] {
	switch (operation.type) {
		case 'accountMerge':
		case 'createAccount':
		case 'pathPaymentStrictReceive':
		case 'pathPaymentStrictSend':
		case 'payment':
			return [{ accountId: operation.destination, role: 'destination' }];
		case 'allowTrust':
		case 'setTrustLineFlags':
			return [{ accountId: operation.trustor, role: 'trustor' }];
		case 'createClaimableBalance':
			return operation.claimants.map((claimant) => ({
				accountId: claimant.destination,
				role: 'claimant'
			}));
		case 'beginSponsoringFutureReserves':
			return [{ accountId: operation.sponsoredId, role: 'sponsored_account' }];
		case 'setOptions':
			return operation.inflationDest === undefined
				? []
				: [
						{
							accountId: operation.inflationDest,
							role: 'inflation_destination'
						}
					];
		case 'clawback':
			return [{ accountId: operation.from, role: 'clawback_source' }];
		case 'revokeAccountSponsorship':
		case 'revokeDataSponsorship':
		case 'revokeSignerSponsorship':
		case 'revokeTrustlineSponsorship':
			return [{ accountId: operation.account, role: 'sponsorship_account' }];
		case 'revokeOfferSponsorship':
			return [{ accountId: operation.seller, role: 'offer_seller' }];
		case 'bumpSequence':
		case 'changeTrust':
		case 'claimClaimableBalance':
		case 'clawbackClaimableBalance':
		case 'createPassiveSellOffer':
		case 'endSponsoringFutureReserves':
		case 'extendFootprintTtl':
		case 'inflation':
		case 'invokeHostFunction':
		case 'liquidityPoolDeposit':
		case 'liquidityPoolWithdraw':
		case 'manageBuyOffer':
		case 'manageData':
		case 'manageSellOffer':
		case 'restoreFootprint':
		case 'revokeClaimableBalanceSponsorship':
		case 'revokeLiquidityPoolSponsorship':
			return [];
		default:
			return assertNever(operation);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Stellar operation: ${String(value)}`);
}
