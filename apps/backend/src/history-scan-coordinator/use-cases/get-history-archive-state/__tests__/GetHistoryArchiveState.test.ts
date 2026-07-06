import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveStateRepository } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateRepository.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { GetHistoryArchiveState } from '../GetHistoryArchiveState.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { Url } from '@core/domain/Url.js';

describe('GetHistoryArchiveState', () => {
	it('falls back to scan metadata when the state table is not deployed yet', async () => {
		const stateRepository = mock<HistoryArchiveStateRepository>();
		const scanRepository = mock<ScanRepository>();
		const exceptionLogger = mock<ExceptionLogger>();
		const missingTableError = new Error('relation does not exist') as Error & {
			code: string;
		};
		missingTableError.code = '42P01';
		stateRepository.findByUrl.mockRejectedValue(missingTableError);
		scanRepository.findLatestByUrl.mockResolvedValue(
			new Scan(
				new Date('2026-07-06T12:00:00.000Z'),
				new Date('2026-07-06T12:00:00.000Z'),
				new Date('2026-07-06T12:01:00.000Z'),
				Url.create('https://history.example.com')._unsafeUnwrap(),
				0,
				63,
				63,
				null,
				1,
				false,
				null,
				[],
				null,
				null,
				[],
				{
					stellarHistoryUrl:
						'https://history.example.com/.well-known/stellar-history.json',
					observedAt: '2026-07-06T12:00:00.000Z',
					stellarHistory: {
						version: 1,
						server: 'stellar-core',
						currentLedger: 63,
						currentBuckets: []
					}
				}
			)
		);

		const result = await new GetHistoryArchiveState(
			stateRepository,
			scanRepository,
			exceptionLogger
		).execute('https://history.example.com');

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			archiveUrl: 'https://history.example.com',
			status: 'available',
			metadata: {
				stellarHistory: {
					currentLedger: 63
				}
			}
		});
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});
});
