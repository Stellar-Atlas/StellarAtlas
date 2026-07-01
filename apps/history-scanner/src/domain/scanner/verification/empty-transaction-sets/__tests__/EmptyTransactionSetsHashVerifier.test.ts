import { EmptyTransactionSetsHashVerifier } from '../EmptyTransactionSetsHashVerifier.js';
import { RegularTransactionSetHashPolicy } from '../hash-policies/RegularTransactionSetHashPolicy.js';
import { GeneralizedTransactionSetHashPolicy } from '../hash-policies/GeneralizedTransactionSetHashPolicy.js';

describe('EmptyTransactionSetsHashVerifier', () => {
	const previousLedgerHeaderHash =
		'ev0m5kh9gybsCHkLBXJKex/KXL072Zl1NV4XTP92mtE=';

	it('should verify the first ledger zero hash', () => {
		const result = EmptyTransactionSetsHashVerifier.verify(
			1,
			20,
			previousLedgerHeaderHash,
			'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
		);
		expect(result._unsafeUnwrap()).toBe(true);
	});

	it('should verify protocol versions before 20 with the regular policy', () => {
		const expectedHash = new RegularTransactionSetHashPolicy().calculateHash(
			previousLedgerHeaderHash
		);

		const result = EmptyTransactionSetsHashVerifier.verify(
			2,
			19,
			previousLedgerHeaderHash,
			expectedHash
		);
		expect(result._unsafeUnwrap()).toBe(true);
	});

	it('should verify protocol version 20 and beyond with the generalized policy', () => {
		const expectedHash =
			new GeneralizedTransactionSetHashPolicy().calculateHash(
				previousLedgerHeaderHash
			);

		const result = EmptyTransactionSetsHashVerifier.verify(
			2,
			20,
			previousLedgerHeaderHash,
			expectedHash
		);
		expect(result._unsafeUnwrap()).toBe(true);
	});

	it('should fall back to the regular policy for protocol transition ledgers', () => {
		const expectedHash = new RegularTransactionSetHashPolicy().calculateHash(
			previousLedgerHeaderHash
		);

		const result = EmptyTransactionSetsHashVerifier.verify(
			2,
			20,
			previousLedgerHeaderHash,
			expectedHash
		);
		expect(result._unsafeUnwrap()).toBe(true);
	});
});
