import {
	Account,
	Asset,
	Claimant,
	encodeMuxedAccount,
	encodeMuxedAccountToAddress,
	Operation,
	StrKey,
	TransactionBuilder
} from '@stellar/stellar-sdk';
import type { FullHistoryTransactionInput } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { fullHistoryUint64 } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryHash } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { decodeStellarFullHistoryOperations } from '../StellarFullHistoryOperationDecoder.js';
import { decodeStellarFullHistoryOperationAccountReferences } from '../StellarFullHistoryOperationAccountReferenceDecoder.js';

const networkPassphrase = 'Operation participant decoder fixture network';

describe('StellarFullHistoryOperationAccountReferenceDecoder', () => {
	it('decodes explicit envelope participants while excluding signers and asset issuers', () => {
		const source = account(1);
		const muxedSource = muxedAccount(source, '7');
		const destinationBase = account(2);
		const destination = muxedAccount(destinationBase, '42');
		const trustor = account(3);
		const claimant = account(4);
		const sponsored = account(5);
		const inflationDestination = account(6);
		const clawbackBase = account(7);
		const clawbackSource = muxedAccount(clawbackBase, '99');
		const sponsorshipAccount = account(8);
		const offerSeller = account(9);
		const signer = account(10);
		const assetIssuer = account(11);
		const asset = new Asset('USD', assetIssuer);
		const transaction = new TransactionBuilder(new Account(source, '1'), {
			fee: '1000',
			networkPassphrase
		})
			.addOperation(
				Operation.payment({
					amount: '1',
					asset,
					destination,
					source: muxedSource
				})
			)
			.addOperation(
				Operation.allowTrust({ assetCode: 'USD', authorize: true, trustor })
			)
			.addOperation(
				Operation.createClaimableBalance({
					amount: '1',
					asset,
					claimants: [new Claimant(claimant)]
				})
			)
			.addOperation(
				Operation.beginSponsoringFutureReserves({ sponsoredId: sponsored })
			)
			.addOperation(
				Operation.setOptions({
					inflationDest: inflationDestination,
					signer: { ed25519PublicKey: signer, weight: 1 }
				})
			)
			.addOperation(
				Operation.clawback({ amount: '1', asset, from: clawbackSource })
			)
			.addOperation(
				Operation.revokeAccountSponsorship({ account: sponsorshipAccount })
			)
			.addOperation(
				Operation.revokeOfferSponsorship({ offerId: '1', seller: offerSeller })
			)
			.setTimeout(0)
			.build();
		const canonicalTransaction = canonical(transaction.hash(), source, 8);
		const operations = decodeStellarFullHistoryOperations(
			transaction,
			canonicalTransaction
		);

		const references = decodeStellarFullHistoryOperationAccountReferences(
			transaction,
			canonicalTransaction,
			operations
		);

		expect(
			references.map(({ accountId, baseAccountId, operationIndex, role }) => ({
				accountId,
				baseAccountId,
				operationIndex,
				role
			}))
		).toEqual([
			{
				accountId: muxedSource,
				baseAccountId: source,
				operationIndex: 0,
				role: 'effective_source'
			},
			{
				accountId: destination,
				baseAccountId: destinationBase,
				operationIndex: 0,
				role: 'destination'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 1,
				role: 'effective_source'
			},
			{
				accountId: trustor,
				baseAccountId: trustor,
				operationIndex: 1,
				role: 'trustor'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 2,
				role: 'effective_source'
			},
			{
				accountId: claimant,
				baseAccountId: claimant,
				operationIndex: 2,
				role: 'claimant'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 3,
				role: 'effective_source'
			},
			{
				accountId: sponsored,
				baseAccountId: sponsored,
				operationIndex: 3,
				role: 'sponsored_account'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 4,
				role: 'effective_source'
			},
			{
				accountId: inflationDestination,
				baseAccountId: inflationDestination,
				operationIndex: 4,
				role: 'inflation_destination'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 5,
				role: 'effective_source'
			},
			{
				accountId: clawbackSource,
				baseAccountId: clawbackBase,
				operationIndex: 5,
				role: 'clawback_source'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 6,
				role: 'effective_source'
			},
			{
				accountId: sponsorshipAccount,
				baseAccountId: sponsorshipAccount,
				operationIndex: 6,
				role: 'sponsorship_account'
			},
			{
				accountId: source,
				baseAccountId: source,
				operationIndex: 7,
				role: 'effective_source'
			},
			{
				accountId: offerSeller,
				baseAccountId: offerSeller,
				operationIndex: 7,
				role: 'offer_seller'
			}
		]);
		expect(references.map((reference) => reference.accountId)).not.toEqual(
			expect.arrayContaining([signer, assetIssuer])
		);
	});
});

function canonical(
	hash: Buffer,
	sourceAccount: string,
	operationCount: number
): FullHistoryTransactionInput {
	return {
		envelopeType: 'tx',
		feeBid: fullHistoryUint64('1000'),
		ledgerSequence: '64',
		operationCount,
		sourceAccount,
		sourceAccountSequence: fullHistoryUint64('1'),
		transactionHash: FullHistoryHash.fromBytes(hash),
		transactionIndex: 0
	};
}

function account(seed: number): string {
	return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
}

function muxedAccount(baseAccount: string, id: string): string {
	return encodeMuxedAccountToAddress(encodeMuxedAccount(baseAccount, id));
}
