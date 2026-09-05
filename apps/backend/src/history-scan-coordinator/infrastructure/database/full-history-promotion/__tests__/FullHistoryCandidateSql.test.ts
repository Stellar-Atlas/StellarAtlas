import {
	fullHistoryObservedEnvelopesSql,
	fullHistoryObservedResultsSql,
	fullHistoryObservedTransactionBoundsSql
} from '../FullHistoryCandidateSql.js';

describe('FullHistoryCandidateSql', () => {
	it('loads parsed transaction data through exact source observations', () => {
		expect(fullHistoryObservedEnvelopesSql).toContain(
			'parsed_transaction_envelope_observation'
		);
		expect(fullHistoryObservedResultsSql).toContain(
			'parsed_transaction_result_observation'
		);
		expect(fullHistoryObservedTransactionBoundsSql).toContain(
			'parsed_transaction_envelope_observation'
		);
		expect(fullHistoryObservedTransactionBoundsSql).toContain(
			'parsed_transaction_result_observation'
		);
		for (const sql of [
			fullHistoryObservedEnvelopesSql,
			fullHistoryObservedResultsSql,
			fullHistoryObservedTransactionBoundsSql
		]) {
			expect(sql).not.toContain('"lastScanJobRemoteId"');
		}
	});
});
