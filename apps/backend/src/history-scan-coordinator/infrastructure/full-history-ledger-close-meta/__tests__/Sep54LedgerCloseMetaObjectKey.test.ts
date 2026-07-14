import { fullHistoryLedgerCloseMetaRange } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { Sep54LedgerCloseMetaConfig } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import {
	createSep54LedgerCloseMetaConfigObjectKey,
	createSep54LedgerCloseMetaObjectKey,
	parseSep54LedgerCloseMetaConfig,
	parseSep54LedgerCloseMetaObjectKey,
	SEP54_MAX_CONFIG_BYTES
} from '../Sep54LedgerCloseMetaObjectKey.js';

const exampleConfig: Sep54LedgerCloseMetaConfig = {
	batchesPerPartition: 8,
	compression: 'zstd',
	ledgersPerBatch: 2,
	networkPassphrase: 'Public Global Stellar Network ; September 2015',
	version: '0.1.0'
};

describe('SEP-54 ledger-close-meta config and object keys', () => {
	it('parses the exact SEP-54 config contract', () => {
		expect(
			parseSep54LedgerCloseMetaConfig(JSON.stringify(exampleConfig))
		).toEqual(exampleConfig);
		expect(
			parseSep54LedgerCloseMetaConfig(
				Buffer.from(JSON.stringify(exampleConfig), 'utf8')
			)
		).toEqual(exampleConfig);
	});

	it.each([
		[2, 3, 'FFFFFFFF--0-15/FFFFFFFD--2-3.xdr.zst'],
		[4, 5, 'FFFFFFFF--0-15/FFFFFFFB--4-5.xdr.zst'],
		[6, 7, 'FFFFFFFF--0-15/FFFFFFF9--6-7.xdr.zst'],
		[8, 9, 'FFFFFFFF--0-15/FFFFFFF7--8-9.xdr.zst'],
		[10, 11, 'FFFFFFFF--0-15/FFFFFFF5--10-11.xdr.zst'],
		[12, 13, 'FFFFFFFF--0-15/FFFFFFF3--12-13.xdr.zst'],
		[14, 15, 'FFFFFFFF--0-15/FFFFFFF1--14-15.xdr.zst'],
		[16, 17, 'FFFFFFEF--16-31/FFFFFFEF--16-17.xdr.zst'],
		[18, 19, 'FFFFFFEF--16-31/FFFFFFED--18-19.xdr.zst']
	])(
		'generates the SEP-54 example key for ledgers %i-%i',
		(start, end, suffix) => {
			expect(
				createSep54LedgerCloseMetaObjectKey(
					exampleConfig,
					fullHistoryLedgerCloseMetaRange(start, end),
					'/stellar/pubnet/'
				).objectKey
			).toBe(`stellar/pubnet/${suffix}`);
		}
	);

	it('omits the partition and end sequence for one-ledger geometry', () => {
		const location = createSep54LedgerCloseMetaObjectKey(
			{ ...exampleConfig, batchesPerPartition: 1, ledgersPerBatch: 1 },
			fullHistoryLedgerCloseMetaRange(2, 2),
			'v1/ledgers/pubnet'
		);
		expect(location).toEqual(
			expect.objectContaining({
				batchFileName: 'FFFFFFFD--2.xdr.zst',
				objectKey: 'v1/ledgers/pubnet/FFFFFFFD--2.xdr.zst',
				partitionDirectory: null
			})
		);
		expect(createSep54LedgerCloseMetaConfigObjectKey('/stellar/pubnet/')).toBe(
			'stellar/pubnet/.config.json'
		);
	});

	it('strictly parses listed object keys back to their declared range', () => {
		const objectKey = 'stellar/pubnet/FFFFFFEF--16-31/FFFFFFED--18-19.xdr.zst';
		expect(
			parseSep54LedgerCloseMetaObjectKey(
				exampleConfig,
				objectKey,
				'stellar/pubnet'
			)
		).toEqual(
			expect.objectContaining({
				objectKey,
				range: { endSequence: 19, ledgerCount: 2, startSequence: 18 }
			})
		);
		expect(() =>
			parseSep54LedgerCloseMetaObjectKey(
				exampleConfig,
				'stellar/pubnet/FFFFFFEF--16-31/FFFFFFFF--18-19.xdr.zst',
				'stellar/pubnet'
			)
		).toThrow(/object-key segment/);
	});

	it('rejects malformed, extended, unsupported, and oversized configs', () => {
		const invalidConfigs: readonly unknown[] = [
			null,
			[],
			{ ...exampleConfig, compression: 'gzip' },
			{ ...exampleConfig, ledgersPerBatch: 0 },
			{ ...exampleConfig, ledgersPerBatch: 1.5 },
			{ ...exampleConfig, unexpected: true }
		];
		for (const config of invalidConfigs) {
			expect(() =>
				parseSep54LedgerCloseMetaConfig(JSON.stringify(config))
			).toThrow(/SEP-54/);
		}
		expect(() => parseSep54LedgerCloseMetaConfig(Buffer.from([0xff]))).toThrow(
			/UTF-8 JSON/
		);
		expect(() =>
			parseSep54LedgerCloseMetaConfig('x'.repeat(SEP54_MAX_CONFIG_BYTES + 1))
		).toThrow(/1-16384 bytes/);
	});

	it('rejects ranges outside the declared geometry and unsafe object paths', () => {
		expect(() =>
			createSep54LedgerCloseMetaObjectKey(
				exampleConfig,
				fullHistoryLedgerCloseMetaRange(2, 2)
			)
		).toThrow(/cardinality/);
		expect(() =>
			createSep54LedgerCloseMetaObjectKey(
				exampleConfig,
				fullHistoryLedgerCloseMetaRange(3, 4)
			)
		).toThrow(/aligned/);
		expect(() =>
			createSep54LedgerCloseMetaObjectKey(
				exampleConfig,
				fullHistoryLedgerCloseMetaRange(2, 3),
				'stellar/../pubnet'
			)
		).toThrow(/object-key segment/);
	});
});
