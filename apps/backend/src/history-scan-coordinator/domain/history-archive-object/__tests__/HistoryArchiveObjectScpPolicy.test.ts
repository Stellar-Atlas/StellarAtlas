import {
	firstPublicNetworkScpCheckpoint,
	historyArchiveScpExpectationKnownSql,
	historyArchiveScpExpectationSql,
	isHistoryArchiveScpObjectExpected,
	publicNetworkPassphrase
} from '../HistoryArchiveObjectScpPolicy.js';

describe('HistoryArchiveObjectScpPolicy', () => {
	it('requires public SCP history at and after its first published checkpoint', () => {
		expect(
			isHistoryArchiveScpObjectExpected({
				checkpointLedger: firstPublicNetworkScpCheckpoint - 64,
				networkPassphrase: publicNetworkPassphrase,
				protocolVersion: 22
			})
		).toBe(false);
		expect(
			isHistoryArchiveScpObjectExpected({
				checkpointLedger: firstPublicNetworkScpCheckpoint,
				networkPassphrase: publicNetworkPassphrase,
				protocolVersion: 22
			})
		).toBe(true);
	});

	it('requires protocol evidence for early non-public proof evaluation', () => {
		const checkpointLedger = firstPublicNetworkScpCheckpoint - 64;

		expect(
			isHistoryArchiveScpObjectExpected({
				checkpointLedger,
				networkPassphrase: 'Test SDF Network ; September 2015'
			})
		).toBe(true);
		expect(
			isHistoryArchiveScpObjectExpected({
				checkpointLedger,
				networkPassphrase: 'Test SDF Network ; September 2015',
				protocolVersion: null
			})
		).toBe(false);
	});

	it('generates proof SQL from the same network and checkpoint constants', () => {
		const sql = historyArchiveScpExpectationSql({
			checkpointLedgerSql: 'checkpoint',
			networkPassphraseSql: 'passphrase',
			protocolVersionSql: 'protocol'
		});

		expect(sql).toContain(String(firstPublicNetworkScpCheckpoint));
		expect(sql).toContain(publicNetworkPassphrase);
		expect(sql).toContain('protocol is not null');
	});

	it('keeps proof expectation unknown without required network/protocol facts', () => {
		const sql = historyArchiveScpExpectationKnownSql({
			checkpointLedgerSql: 'checkpoint',
			networkPassphraseSql: 'passphrase',
			protocolVersionSql: 'protocol'
		});

		expect(sql).toContain('checkpoint >=');
		expect(sql).toContain(`passphrase = '${publicNetworkPassphrase}'`);
		expect(sql).toContain('protocol is not null');
	});
});
