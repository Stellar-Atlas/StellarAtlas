import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	StrKey,
	TransactionBuilder
} from '@stellar/stellar-sdk';
import { normalizeNativePoolId } from '../HubbleExplorerQuery.js';
import { transactionEnvelopeOperations } from '../HubbleTransactionEnvelope.js';

describe('Hubble SDK byte contracts', () => {
	it('normalizes SDK Uint8Array liquidity-pool bytes to the existing hex identifier', () => {
		const bytes = new Uint8Array(32).fill(0xab);
		expect(normalizeNativePoolId(StrKey.encodeLiquidityPool(bytes))).toBe(
			'ab'.repeat(32)
		);
		expect(normalizeNativePoolId('AB'.repeat(32))).toBe('ab'.repeat(32));
		expect(() => normalizeNativePoolId('not-a-pool')).toThrow();
	});

	it('checks the exact envelope hash before exposing decoded operation amounts', () => {
		const source = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(1));
		const destination = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(2));
		const transaction = new TransactionBuilder(
			new Account(source.publicKey(), '1'),
			{
				fee: '100',
				networkPassphrase: Networks.PUBLIC
			}
		)
			.addOperation(
				Operation.payment({
					destination: destination.publicKey(),
					asset: Asset.native(),
					amount: '1.0000001'
				})
			)
			.setTimeout(0)
			.build();
		const hash = Buffer.from(transaction.hash()).toString('hex');
		expect(transactionEnvelopeOperations(transaction.toXDR(), hash)).toEqual(
			transaction.operations
		);
		expect(
			transactionEnvelopeOperations(transaction.toXDR(), '00'.repeat(32))
		).toBeNull();
		expect(transactionEnvelopeOperations('not-base64-xdr', hash)).toBeNull();
	});
});
