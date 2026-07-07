import {
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO
} from '../ParsedTransactionDTO.js';

describe('ParsedTransactionEnvelopeBatchDTO', () => {
	it('should parse valid transaction envelope batches', () => {
		const result = ParsedTransactionEnvelopeBatchDTO.fromJSON({
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [
				{
					envelopeXdr: 'AAAA-envelope',
					ledgerSequence: 63355967,
					transactionIndex: 4,
					transactionSetHash: 'transaction-set-hash'
				}
			],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.records[0].transactionIndex).toBe(4);
		expect(result.value.observedAt.toISOString()).toBe(
			'2026-07-07T19:30:00.000Z'
		);
	});

	it.each([
		{
			observedAt: 'bad-date',
			records: [],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		},
		{
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [{ ledgerSequence: -1 }],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		},
		{
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [{ ledgerSequence: 1, transactionIndex: 0 }],
			scanJobRemoteId: '',
			sourceArchiveUrl: 'https://history.example'
		}
	])('should reject invalid envelope batches %#', (json) => {
		expect(ParsedTransactionEnvelopeBatchDTO.fromJSON(json).isErr()).toBe(true);
	});
});

describe('ParsedTransactionResultBatchDTO', () => {
	it('should parse valid transaction result batches', () => {
		const result = ParsedTransactionResultBatchDTO.fromJSON({
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [
				{
					ledgerSequence: 63355967,
					resultXdr: 'AAAA-result',
					transactionHash: 'transaction-hash',
					transactionIndex: 4,
					transactionResultHash: 'transaction-result-hash'
				}
			],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.records[0].transactionHash).toBe('transaction-hash');
	});

	it.each([
		{
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [{ ledgerSequence: 1, transactionIndex: 1 }],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		},
		{
			observedAt: '2026-07-07T19:30:00.000Z',
			records: [
				{
					ledgerSequence: 1,
					resultXdr: 'AAAA-result',
					transactionHash: '',
					transactionIndex: 1,
					transactionResultHash: 'hash'
				}
			],
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.example'
		}
	])('should reject invalid result batches %#', (json) => {
		expect(ParsedTransactionResultBatchDTO.fromJSON(json).isErr()).toBe(true);
	});
});
