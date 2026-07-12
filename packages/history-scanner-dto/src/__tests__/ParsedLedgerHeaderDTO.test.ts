import { ParsedLedgerHeaderBatchDTO } from '../ParsedLedgerHeaderDTO.js';

describe('ParsedLedgerHeaderBatchDTO', () => {
	it('should parse valid ledger header batches', () => {
		const result = ParsedLedgerHeaderBatchDTO.fromJSON({
			headers: [
				{
					bucketListHash: 'bucket-list',
					closedAt: '2026-07-05T01:42:50.000Z',
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
			sourceArchiveUrl:
				'https://history.stellar.org/prd/core-live/core_live_001'
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.observedAt.toISOString()).toBe(
			'2026-07-05T01:42:51.000Z'
		);
		expect(result.value.headers[0].ledgerSequence).toBe(63332922);
		expect(result.value.headers[0].closedAt).toBe('2026-07-05T01:42:50.000Z');
	});

	it('should accept legacy headers without a close time', () => {
		const result = ParsedLedgerHeaderBatchDTO.fromJSON({
			headers: [validHeader()],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		});

		expect(result.isOk()).toBe(true);
	});

	it('should accept an explicit null close time for compatibility', () => {
		const result = ParsedLedgerHeaderBatchDTO.fromJSON({
			headers: [{ ...validHeader(), closedAt: null }],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		});

		expect(result.isOk()).toBe(true);
	});

	it.each([
		{
			headers: [],
			observedAt: 'bad-date',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		},
		{
			headers: [{ ledgerSequence: -1 }],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		},
		{
			headers: [{ ledgerSequence: 1.5 }],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		},
		{
			headers: [{ ledgerSequence: 1, protocolVersion: 23 }],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: '',
			sourceArchiveUrl: 'https://history.stellar.org'
		},
		{
			headers: [{ ...validHeader(), closedAt: '2026-07-05' }],
			observedAt: '2026-07-05T01:42:51.000Z',
			scanJobRemoteId: 'job-1',
			sourceArchiveUrl: 'https://history.stellar.org'
		}
	])('should reject invalid batches %#', (json) => {
		expect(ParsedLedgerHeaderBatchDTO.fromJSON(json).isErr()).toBe(true);
	});

	it.each([
		{ ledgerSequence: 0x1_0000_0000 },
		{ ledgerSequence: Number.MAX_SAFE_INTEGER + 1 },
		{ protocolVersion: 0x8000_0000 }
	])(
		'should reject values outside storage-safe integer bounds %#',
		(override) => {
			expect(
				ParsedLedgerHeaderBatchDTO.fromJSON(
					validBatch([{ ...validHeader(), ...override }])
				).isErr()
			).toBe(true);
		}
	);

	it('should accept the maximum supported ledger and protocol values', () => {
		const result = ParsedLedgerHeaderBatchDTO.fromJSON(
			validBatch([
				{
					...validHeader(),
					ledgerSequence: 0xffff_ffff,
					protocolVersion: 0x7fff_ffff
				}
			])
		);

		expect(result.isOk()).toBe(true);
	});

	it('should leave duplicate identity classification to the repository', () => {
		const header = validHeader();
		expect(
			ParsedLedgerHeaderBatchDTO.fromJSON(
				validBatch([header, { ...header }])
			).isOk()
		).toBe(true);
	});

	it('should allow competing hashes at the same ledger sequence', () => {
		const header = validHeader();
		expect(
			ParsedLedgerHeaderBatchDTO.fromJSON(
				validBatch([
					header,
					{ ...header, ledgerHeaderHash: 'competing-ledger-header' }
				])
			).isOk()
		).toBe(true);
	});

	it('should reject batches too large for a bounded insert', () => {
		const headers = Array.from({ length: 1_001 }, (_, index) => ({
			...validHeader(),
			ledgerSequence: index
		}));

		expect(
			ParsedLedgerHeaderBatchDTO.fromJSON(validBatch(headers)).isErr()
		).toBe(true);
	});
});

function validBatch(headers: readonly ReturnType<typeof validHeader>[]) {
	return {
		headers,
		observedAt: '2026-07-05T01:42:51.000Z',
		scanJobRemoteId: 'job-1',
		sourceArchiveUrl: 'https://history.stellar.org'
	};
}

function validHeader() {
	return {
		bucketListHash: 'bucket-list',
		ledgerHeaderHash: 'ledger-header',
		ledgerSequence: 63332922,
		previousLedgerHeaderHash: 'previous-ledger-header',
		protocolVersion: 23,
		transactionResultHash: 'tx-result',
		transactionSetHash: 'tx-set'
	};
}
