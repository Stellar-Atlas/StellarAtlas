import {
	buildAnalyticsLedgerPath,
	parseAnalyticsLedgerLookup
} from '../explorer-record-lookup';

describe('parsed analytics ledger lookup', () => {
	const ledger = {
		ledger: {
			sequence: 64877689,
			ledger_hash: 'd0c250c6b0c69dbce30b9bf8144bff65e0eb0fa1410a43ae9825e2e6700a0869',
			closed_at: '2026-10-10 23:17:07.000000',
			operation_count: 475,
			transaction_count: 251,
			protocol_version: 29
		}
	};

	it('uses the published analytics ledger endpoint and adapts canonical fields', () => {
		expect(buildAnalyticsLedgerPath('64877689')).toBe('/v1/analytics/ledgers/64877689');
		expect(buildAnalyticsLedgerPath('1/2')).toBe('/v1/analytics/ledgers/1%2F2');
		expect(parseAnalyticsLedgerLookup('64877689', ledger, '2026-10-11T00:00:00Z')).toEqual({
			message: null,
			observedAt: '2026-10-11T00:00:00Z',
			status: 'loaded',
			search: {
				query: '64877689',
				resultType: 'ledger',
				source: 'analytics_warehouse',
				result: {
					sequence: '64877689',
					hash: ledger.ledger.ledger_hash,
					closedAt: '2026-10-10T23:17:07.000Z',
					operationCount: 475,
					transactionCount: 251,
					protocolVersion: 29,
					source: 'analytics_warehouse'
				}
			}
		});
	});

	it('rejects a mismatched or incomplete response rather than rendering a false empty record', () => {
		expect(() => parseAnalyticsLedgerLookup('64877690', ledger)).toThrow('invalid ledger metadata');
		expect(() => parseAnalyticsLedgerLookup('64877689', { ledger: { ...ledger.ledger, ledger_hash: 'bad' } })).toThrow('invalid ledger metadata');
	});
});
