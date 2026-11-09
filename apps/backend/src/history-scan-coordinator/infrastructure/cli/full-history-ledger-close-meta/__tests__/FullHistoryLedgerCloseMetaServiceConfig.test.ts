import { parseFullHistoryLedgerCloseMetaServiceConfig } from '../FullHistoryLedgerCloseMetaServiceConfig.js';

describe('parseFullHistoryLedgerCloseMetaServiceConfig', () => {
	it('uses the bounded production resource and storage defaults', () => {
		const config = parseFullHistoryLedgerCloseMetaServiceConfig(environment());

		expect(config).toEqual(
			expect.objectContaining({
				cycleLedgerCount: 1_024,
				fetchConcurrency: 12,
				ingressBytesPerSecond: 187_500_000,
				lastAvailableLedger: null,
				processingConcurrency: 1,
				publicationStagingRoot: null,
				temporaryInputRoot: '/dev/shm/stellaratlas-full-history-etl',
				typedOutputRoot: '/home/observe/stellarbeat-data/full-history/typed',
				typedShardLedgerCount: 1_024
			})
		);
		expect(config.minimumFreeBytes).toBe(5n * 1_024n ** 4n);
		expect(config.minimumFreeBasisPoints).toBe(1_000);
		expect(config.maximumStoredBytes).toBe(40n * 1_024n ** 4n);
	});

	it('accepts a disjoint absolute publication staging root', () => {
		const config = parseFullHistoryLedgerCloseMetaServiceConfig({
			...environment(),
			FULL_HISTORY_LEDGER_CLOSE_META_PUBLICATION_STAGING_ROOT:
				'/mnt/stellaratlas-archive-spool/full-history-etl'
		});

		expect(config.publicationStagingRoot).toBe(
			'/mnt/stellaratlas-archive-spool/full-history-etl'
		);
	});

	it('wires a complete finite current allowance only with current priority enabled', () => {
		const values = {
			...environment(),
			FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_MIN_LEDGER: '1000',
			FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_RESERVE_BORROW_BYTES: '549755813888',
			FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString()
		};
		expect(() => parseFullHistoryLedgerCloseMetaServiceConfig(values)).toThrow(/requires prioritize current/);
		const config = parseFullHistoryLedgerCloseMetaServiceConfig({ ...values,
			FULL_HISTORY_LEDGER_CLOSE_META_PRIORITIZE_CURRENT: 'true' });
		expect(config.currentCapacityAllowance?.minimumLedger).toBe(1000);
		expect(config.currentCapacityAllowance?.maximumReserveBorrowBytes).toBe(512n * 1024n ** 3n);
	});

	it('opts in to durable current-only capacity without changing the ordinary floor', () => {
		const values = {
			...environment(),
			FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MIN_LEDGER: '1000',
			FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES: '4000',
			FULL_HISTORY_LEDGER_CLOSE_META_MINIMUM_FREE_BYTES: '5000',
			FULL_HISTORY_LEDGER_CLOSE_META_PRIORITIZE_CURRENT: 'true'
		};
		const config = parseFullHistoryLedgerCloseMetaServiceConfig(values);
		expect(config.currentOnlyCapacity).toEqual({ minimumLedger: 1000, minimumFreeBytes: 4000n });
		expect(config.minimumFreeBytes).toBe(5000n);
		for (const overrides of [
			{ FULL_HISTORY_LEDGER_CLOSE_META_PRIORITIZE_CURRENT: 'false' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_ADMISSION_ENABLED: 'false' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER: '1026' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MIN_LEDGER: undefined },
			{ FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MIN_LEDGER: '2' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES: '0' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES: '4000\n' },
			{ FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES: '5000' },
			{
				FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_MIN_LEDGER: '1000',
				FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_RESERVE_BORROW_BYTES: '1000',
				FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_EXPIRES_AT: '2026-01-01T00:00:00.000Z'
			}
		]) {
			expect(() => parseFullHistoryLedgerCloseMetaServiceConfig({ ...values, ...overrides })).toThrow();
		}
	});

	it('accepts multiple admitted shards with bounded parallel processing', () => {
		const config = parseFullHistoryLedgerCloseMetaServiceConfig({
			...environment(),
			FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS: '12288',
			FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY: '256',
			FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY: '12'
		});

		expect(config.cycleLedgerCount).toBe(12_288);
		expect(config.fetchConcurrency).toBe(256);
		expect(config.processingConcurrency).toBe(12);
	});

	it('accepts an inclusive bounded range made of complete typed shards', () => {
		const config = parseFullHistoryLedgerCloseMetaServiceConfig({
			...environment(),
			FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS: '64',
			FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER: '66',
			FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '64'
		});

		expect(config.firstAvailableLedger).toBe(3);
		expect(config.lastAvailableLedger).toBe(66);
	});

	it.each(['2', '65', '67'])(
		'rejects invalid bounded last ledger %s',
		(last) => {
			expect(() =>
				parseFullHistoryLedgerCloseMetaServiceConfig({
					...environment(),
					FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS: '64',
					FULL_HISTORY_LEDGER_CLOSE_META_LAST_LEDGER: last,
					FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '64'
				})
			).toThrow();
		}
	);

	it.each([
		{
			FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY: '1025'
		},
		{
			FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY: '65'
		},
		{
			FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BYTES_PER_SECOND: '187500001'
		},
		{
			FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '1025'
		},
		{
			FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '63'
		},
		{
			FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '1000',
			FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS: '8192'
		}
	])(
		'rejects resource settings that exceed or split a bounded lane',
		(extra) => {
			expect(() =>
				parseFullHistoryLedgerCloseMetaServiceConfig({
					...environment(),
					...extra
				})
			).toThrow();
		}
	);

	it('rejects typed output outside bulk storage or inside transient input', () => {
		expect(() =>
			parseFullHistoryLedgerCloseMetaServiceConfig({
				...environment(),
				FULL_HISTORY_LEDGER_CLOSE_META_TYPED_ROOT: '/var/lib/full-history'
			})
		).toThrow(/bulk storage/i);
		expect(() =>
			parseFullHistoryLedgerCloseMetaServiceConfig({
				...environment(),
				FULL_HISTORY_BULK_ROOT: '/dev/shm',
				FULL_HISTORY_LEDGER_CLOSE_META_TEMP_ROOT: '/dev/shm/transient',
				FULL_HISTORY_LEDGER_CLOSE_META_TYPED_ROOT: '/dev/shm/transient/typed'
			})
		).toThrow(/disjoint/i);
	});

	it('rejects transient provider storage outside shared memory', () => {
		expect(() =>
			parseFullHistoryLedgerCloseMetaServiceConfig({
				...environment(),
				FULL_HISTORY_LEDGER_CLOSE_META_TEMP_ROOT: '/tmp/full-history'
			})
		).toThrow(/\/dev\/shm/i);
	});
});

function environment(): NodeJS.ProcessEnv {
	return {
		FULL_HISTORY_LEDGER_CLOSE_META_ENABLED: 'true',
		FULL_HISTORY_NETWORK_PASSPHRASE:
			'Public Global Stellar Network ; September 2015'
	};
}
