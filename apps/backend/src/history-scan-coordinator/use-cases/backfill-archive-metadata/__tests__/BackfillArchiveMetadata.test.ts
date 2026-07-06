import { mock, MockProxy } from 'jest-mock-extended';
import type { Logger } from 'logger';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { BackfillArchiveMetadata } from '../BackfillArchiveMetadata.js';

describe('BackfillArchiveMetadata', () => {
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let loggerMock: MockProxy<Logger>;
	let fetchSpy: jest.SpiedFunction<typeof fetch>;
	let backfillArchiveMetadata: BackfillArchiveMetadata;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
		scanRepositoryMock = mock<ScanRepository>();
		loggerMock = mock<Logger>();
		fetchSpy = jest.spyOn(globalThis, 'fetch');
		backfillArchiveMetadata = new BackfillArchiveMetadata(
			scanRepositoryMock,
			loggerMock
		);
	});

	afterEach(() => {
		fetchSpy.mockRestore();
		jest.useRealTimers();
	});

	it('updates selected scan rows with scanner-owned HAS metadata', async () => {
		scanRepositoryMock.findUrlsMissingSelectedArchiveMetadata.mockResolvedValue(
			['https://history.example.com/']
		);
		scanRepositoryMock.backfillSelectedArchiveMetadata.mockResolvedValue(true);
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify(createHistoryArchiveState()), {
				status: 200
			})
		);

		const result = await backfillArchiveMetadata.execute({ limit: 1 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			candidateCount: 1,
			updatedCount: 1,
			skippedCount: 0,
			failedCount: 0,
			failures: []
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://history.example.com/.well-known/stellar-history.json',
			expect.objectContaining({
				headers: { accept: 'application/json' }
			})
		);
		expect(
			scanRepositoryMock.backfillSelectedArchiveMetadata
		).toHaveBeenCalledWith('https://history.example.com/', {
			stellarHistoryUrl:
				'https://history.example.com/.well-known/stellar-history.json',
			stellarHistory: createHistoryArchiveState(),
			observedAt: '2026-07-06T12:00:00.000Z'
		});
	});

	it('reports invalid HAS responses without updating scan rows', async () => {
		scanRepositoryMock.findUrlsMissingSelectedArchiveMetadata.mockResolvedValue(
			['https://history.example.com']
		);
		fetchSpy.mockResolvedValue(
			new Response(JSON.stringify({ currentLedger: 'bad' }), { status: 200 })
		);

		const result = await backfillArchiveMetadata.execute({ limit: 1 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			candidateCount: 1,
			updatedCount: 0,
			skippedCount: 0,
			failedCount: 1,
			failures: [
				{
					archiveUrl: 'https://history.example.com',
					error: 'HAS response did not match expected shape'
				}
			]
		});
		expect(
			scanRepositoryMock.backfillSelectedArchiveMetadata
		).not.toHaveBeenCalled();
	});

	it('returns repository errors', async () => {
		const error = new Error('database unavailable');
		scanRepositoryMock.findUrlsMissingSelectedArchiveMetadata.mockRejectedValue(
			error
		);

		const result = await backfillArchiveMetadata.execute({ limit: 1 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});

function createHistoryArchiveState() {
	return {
		version: 1,
		server: 'stellar-core 27.0.0',
		currentLedger: 63350000,
		currentBuckets: [
			{
				curr: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
				snap: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
				next: { state: 0 }
			}
		]
	};
}
