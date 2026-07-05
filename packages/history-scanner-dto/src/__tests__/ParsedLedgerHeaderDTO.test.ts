import { ParsedLedgerHeaderBatchDTO } from '../ParsedLedgerHeaderDTO.js';

describe('ParsedLedgerHeaderBatchDTO', () => {
	it('should parse valid ledger header batches', () => {
		const result = ParsedLedgerHeaderBatchDTO.fromJSON({
			headers: [
				{
					bucketListHash: 'bucket-list',
					ledgerHeaderHash: 'ledger-header',
					ledgerSequence: 63332922,
					previousLedgerHeaderHash: 'previous-ledger-header',
					protocolVersion: 23,
					transactionResultHash: 'tx-result',
					transactionSetHash: 'tx-set'
				}
			],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org/prd/core-live/core_live_001'
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.observedAt.toISOString()).toBe(
			'2026-07-05T01:42:51.000Z'
		);
		expect(result.value.headers[0].ledgerSequence).toBe(63332922);
	});

	it.each([
		{ headers: [], observedAt: 'bad-date', scanJobRemoteId: 'job-1', sourceArchiveUrl: 'https://history.stellar.org' },
		{ headers: [{ ledgerSequence: -1 }], observedAt: '2026-07-05T01:42:51.000Z', scanJobRemoteId: 'job-1', sourceArchiveUrl: 'https://history.stellar.org' },
		{ headers: [{ ledgerSequence: 1.5 }], observedAt: '2026-07-05T01:42:51.000Z', scanJobRemoteId: 'job-1', sourceArchiveUrl: 'https://history.stellar.org' },
		{ headers: [{ ledgerSequence: 1, protocolVersion: 23 }], observedAt: '2026-07-05T01:42:51.000Z', scanJobRemoteId: '', sourceArchiveUrl: 'https://history.stellar.org' }
	])('should reject invalid batches %#', (json) => {
		expect(ParsedLedgerHeaderBatchDTO.fromJSON(json).isErr()).toBe(true);
	});
});
