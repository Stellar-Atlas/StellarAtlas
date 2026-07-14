import {
	assertFullHistoryLedgerCloseMetaMemoryEnvelope,
	FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES
} from '../FullHistoryLedgerCloseMetaComposition.js';

describe('FullHistoryLedgerCloseMetaComposition', () => {
	it('keeps eight processors below the 96 GiB service memory limit', () => {
		expect(FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES).toBe(
			96 * 1_024 ** 3
		);
		expect(() => assertFullHistoryLedgerCloseMetaMemoryEnvelope(8)).not.toThrow();
	});

	it('rejects a processor count outside the aggregate memory envelope', () => {
		expect(() => assertFullHistoryLedgerCloseMetaMemoryEnvelope(9)).toThrow(
			/memory envelope/i
		);
	});
});
