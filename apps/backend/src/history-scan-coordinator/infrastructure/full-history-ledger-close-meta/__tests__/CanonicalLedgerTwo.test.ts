import { canonicalLedgerTwoBootstrap } from '../CanonicalLedgerTwo.js';
import { StellarLedgerCloseMetaBatchDecoder } from '../StellarLedgerCloseMetaBatchDecoder.js';

describe('canonical ledger two', () => {
	it('is the exact empty pubnet ledger linked to synthetic genesis', () => {
		const value = canonicalLedgerTwoBootstrap(
			'Public Global Stellar Network ; September 2015',
			new Date('2026-08-27T00:00:00.000Z')
		);
		const decoded = new StellarLedgerCloseMetaBatchDecoder({
			maximumCompressedBytes: 1_024,
			maximumUncompressedBytes: 4_096
		}).decode({
			compressedPayload: value.object.bytes,
			expectedRange: {
				endSequence: value.registration.firstAvailableLedger,
				ledgerCount: 1,
				startSequence: value.registration.firstAvailableLedger
			}
		});
		const meta = decoded.ledgers[0]!.ledgerCloseMeta.v0();
		expect(meta.ledgerHeader().header().ledgerSeq()).toBe(2);
		expect(meta.txSet().txes()).toHaveLength(0);
		expect(meta.txProcessing()).toHaveLength(0);
		expect(meta.upgradesProcessing()).toHaveLength(2);
		expect(meta.ledgerHeader().hash().toString('hex')).toBe(
			'fe0f6bea5f341344fdb5bc6fc4ad719dd63071d9203e9a1e7f17c68ea1ecebde'
		);
		expect(
			meta.ledgerHeader().header().previousLedgerHash().toString('hex')
		).toBe('39c2a3cd4141b2853e70d84601faa44744660334b48f3228e0309342e3f4eb48');
	});

	it('refuses to apply pubnet evidence to another network', () => {
		expect(() =>
			canonicalLedgerTwoBootstrap('Test SDF Network ; 2015')
		).toThrow('pubnet-only');
	});
});
