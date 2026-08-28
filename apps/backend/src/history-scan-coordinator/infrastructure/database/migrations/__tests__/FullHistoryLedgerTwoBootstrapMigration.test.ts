import {
	allowFullHistoryLedgerTwoBootstrapSql,
	restoreFullHistoryLedgerCloseMetaRangeSql
} from '../FullHistoryLedgerTwoBootstrapSql.js';

describe('FullHistoryLedgerTwoBootstrapSql', () => {
	it('allows only the exact one-ledger bootstrap exception', () => {
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'"start_ledger" = 2'
		);
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain('"end_ledger" = 2');
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'"ledger_count" = 1'
		);
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'"ledger_count" between 64 and 1024'
		);
	});

	it('requires the immutable ledger-two batch to link to ledger three', () => {
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'ledger_two."last_ledger_hash" <>'
		);
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'ledger_three_batch."first_previous_ledger_hash"'
		);
		expect(allowFullHistoryLedgerTwoBootstrapSql).toContain(
			'assert_full_history_lcm_batch_dataset_set(ledger_two."id")'
		);
	});

	it('refuses to remove support after immutable ledger two exists', () => {
		expect(restoreFullHistoryLedgerCloseMetaRangeSql).toContain(
			'cannot remove ledger-two support while the immutable batch exists'
		);
	});
});
