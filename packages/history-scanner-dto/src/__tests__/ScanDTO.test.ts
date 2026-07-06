import { ScanDTO } from '../ScanDTO.js';

describe('ScanDTO', () => {
	describe('fromJSON', () => {
		it('should parse valid JSON with all fields', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: null,
				errors: [],
				archiveMetadata: {
					stellarHistoryUrl:
						'https://history.stellar.org/.well-known/stellar-history.json',
					stellarHistory: {
						version: 1,
						server: 'stellar-core',
						currentLedger: 100,
						currentBuckets: []
					},
					observedAt: '2024-01-01T00:00:00.000Z'
				},
				evidence: [
					{
						bucketHash:
							'32900289ef7cd0eb0f5982cc58fc489abb1efb53a99de8142d2b68bcc1ec36b8',
						kind: 'bucket',
						status: 'verified',
						url: 'https://history.stellar.org/bucket/32/90/02/bucket-32900289ef7cd0eb0f5982cc58fc489abb1efb53a99de8142d2b68bcc1ec36b8.xdr.gz'
					}
				],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			const dto = result.value;
			expect(dto.startDate).toBeInstanceOf(Date);
			expect(dto.startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z');
			expect(dto.endDate).toBeInstanceOf(Date);
			expect(dto.endDate.toISOString()).toBe('2024-01-01T01:00:00.000Z');
			expect(dto.baseUrl).toBe('https://history.stellar.org');
			expect(dto.scanChainInitDate).toBeInstanceOf(Date);
			expect(dto.fromLedger).toBe(1);
			expect(dto.toLedger).toBe(100);
			expect(dto.latestVerifiedLedger).toBe(90);
			expect(dto.latestScannedLedger).toBe(95);
			expect(dto.latestScannedLedgerHeaderHash).toBe('hash123');
			expect(dto.concurrency).toBe(5);
			expect(dto.isSlowArchive).toBe(false);
			expect(dto.error).toBeNull();
			expect(dto.archiveMetadata?.stellarHistory.currentLedger).toBe(100);
			expect(dto.evidence).toHaveLength(1);
			expect(dto.scanJobRemoteId).toBe('test');
		});

		it('should parse JSON with null optional fields', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: null,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: null,
				concurrency: 5,
				isSlowArchive: null,
				error: null,
				errors: [],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			const dto = result.value;
			expect(dto.toLedger).toBeNull();
			expect(dto.latestScannedLedgerHeaderHash).toBeNull();
			expect(dto.isSlowArchive).toBeNull();
		});

		it('should parse archive metadata with nullable history archive state fields', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: null,
				errors: [],
				archiveMetadata: {
					stellarHistoryUrl:
						'https://history.stellar.org/.well-known/stellar-history.json',
					stellarHistory: {
						version: 1,
						server: 'stellar-core',
						currentLedger: 100,
						networkPassphrase: null,
						currentBuckets: [
							{
								curr: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
								snap: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
								next: { state: 0, output: null }
							}
						]
					},
					observedAt: '2024-01-01T00:00:00.000Z'
				},
				evidence: [],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			expect(
				result.value.archiveMetadata?.stellarHistory.networkPassphrase
			).toBeNull();
			expect(
				result.value.archiveMetadata?.stellarHistory.currentBuckets[0]?.next
					.output
			).toBeNull();
		});

		it('should parse JSON with error object', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: {
					type: 'TYPE_VERIFICATION',
					url: 'https://history.stellar.org',
					message: 'Invalid checksum'
				},
				errors: [
					{
						type: 'TYPE_VERIFICATION',
						url: 'https://history.stellar.org',
						message: 'Invalid checksum'
					}
				],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			const dto = result.value;
			expect(dto.error).toEqual({
				type: 'TYPE_VERIFICATION',
				url: 'https://history.stellar.org',
				message: 'Invalid checksum'
			});
			expect(dto.errors).toHaveLength(1);
		});

		it('should reject JSON with unsupported error types', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: {
					type: 'validation',
					url: 'https://history.stellar.org',
					message: 'Invalid checksum'
				},
				errors: [
					{
						type: 'TYPE_CONNECTION',
						url: 'https://history.stellar.org',
						message: 'Could not fetch latest ledger'
					}
				],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isErr()).toBe(true);

			const jsonWithInvalidErrorList = {
				...json,
				error: null,
				errors: [
					{
						type: 'validation',
						url: 'https://history.stellar.org',
						message: 'Invalid checksum'
					}
				]
			};

			const listResult = ScanDTO.fromJSON(jsonWithInvalidErrorList);
			expect(listResult.isErr()).toBe(true);
		});

		it('should reject JSON with invalid evidence', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: null,
				errors: [],
				evidence: [
					{
						bucketHash: 'not-a-bucket-hash',
						kind: 'bucket',
						status: 'verified',
						url: 'https://history.stellar.org/bucket/not-a-bucket-hash.xdr.gz'
					}
				],
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isErr()).toBe(true);
		});

		it('should reject JSON with invalid archive metadata', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z',
				endDate: '2024-01-01T01:00:00.000Z',
				baseUrl: 'https://history.stellar.org',
				scanChainInitDate: '2024-01-01T00:00:00.000Z',
				fromLedger: 1,
				toLedger: 100,
				latestVerifiedLedger: 90,
				latestScannedLedger: 95,
				latestScannedLedgerHeaderHash: 'hash123',
				concurrency: 5,
				isSlowArchive: false,
				error: null,
				errors: [],
				archiveMetadata: {
					stellarHistoryUrl: 'https://history.stellar.org/.well-known/stellar-history.json',
					stellarHistory: {
						version: 1,
						server: 'stellar-core',
						currentBuckets: []
					},
					observedAt: '2024-01-01T00:00:00.000Z'
				},
				scanJobRemoteId: 'test'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isErr()).toBe(true);
		});

		it('should return error for missing required fields', () => {
			const json = {
				startDate: '2024-01-01T00:00:00.000Z'
			};

			const result = ScanDTO.fromJSON(json);
			expect(result.isErr()).toBe(true);
		});
	});
});
