import {
	fullHistoryObservedEnvelopesSql,
	fullHistoryObservedResultsSql,
	fullHistoryObservedTransactionBoundsSql
} from '../FullHistoryCandidateSql.js';

describe('FullHistoryCandidateSql', () => {
	it('selects transactions by the exact proof-gated ledger hashes', () => {
		for (const sql of [
			fullHistoryObservedEnvelopesSql,
			fullHistoryObservedResultsSql,
			fullHistoryObservedTransactionBoundsSql
		]) {
			expect(sql).toContain('parsed_ledger_header_observation');
			expect(sql).not.toContain('"lastScanJobRemoteId"');
			expect(sql).not.toContain('parsed_transaction_envelope_observation');
			expect(sql).not.toContain('parsed_transaction_result_observation');
		}
		expect(fullHistoryObservedEnvelopesSql).toContain(
			'envelope."transactionSetHash" = header."transactionSetHash"'
		);
		expect(fullHistoryObservedResultsSql).toContain(
			'result."transactionResultHash" = header."transactionResultHash"'
		);
	});
});
