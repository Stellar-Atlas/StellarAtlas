import { mock, MockProxy } from 'jest-mock-extended';
import { ok, err } from 'neverthrow';
import { HistoryArchiveScan } from 'shared';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetCrossCheckArchives } from '../GetCrossCheckArchives.js';

describe('GetCrossCheckArchives', () => {
	let getArchiveScans: MockProxy<GetArchiveScans>;
	let getCrossCheckArchives: GetCrossCheckArchives;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getArchiveScans = mock<GetArchiveScans>();
		getCrossCheckArchives = new GetCrossCheckArchives(getArchiveScans);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should map clean, archive-error, worker-only, and mixed rows', async () => {
		getArchiveScans.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T11:59:00.000Z',
				limit: 4,
				count: 4,
				scans: [
					new HistoryArchiveScan(
						'https://clean.example.com',
						new Date('2026-07-03T08:00:00.000Z'),
						new Date('2026-07-03T08:01:00.000Z'),
						127,
						false,
						null,
						null,
						false,
						[]
					),
					new HistoryArchiveScan(
						'https://archive-error.example.com',
						new Date('2026-07-03T10:00:00.000Z'),
						new Date('2026-07-03T10:05:00.000Z'),
						127,
						true,
						'https://archive-error.example.com/ledger.xdr.gz',
						'Wrong ledger hash',
						false,
						[
							{
								type: 'TYPE_VERIFICATION',
								url: 'https://archive-error.example.com/ledger.xdr.gz',
								message: 'Wrong ledger hash'
							}
						]
					),
					new HistoryArchiveScan(
						'https://worker-only.example.com',
						new Date('2026-07-03T09:00:00.000Z'),
						new Date('2026-07-03T09:01:00.000Z'),
						0,
						false,
						null,
						null,
						false,
						[
							{
								type: 'TYPE_CONNECTION',
								url: 'https://worker-only.example.com',
								message: 'Could not fetch latest ledger'
							}
						]
					),
					new HistoryArchiveScan(
						'https://mixed.example.com',
						new Date('2026-07-03T10:00:00.000Z'),
						new Date('2026-07-03T10:05:00.000Z'),
						255,
						true,
						'https://mixed.example.com/ledger.xdr.gz',
						'Wrong transaction hash',
						true,
						[
							{
								type: 'TYPE_VERIFICATION',
								url: 'https://mixed.example.com/ledger.xdr.gz',
								message: 'Wrong transaction hash'
							},
							{
								type: 'TYPE_CONNECTION',
								url: 'https://mixed.example.com',
								message: 'Worker timeout'
							}
						]
					)
				]
			})
		);

		const result = await getCrossCheckArchives.execute({ limit: 4 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			limit: 4,
			count: 4,
			probe: 'not_run',
			comparisonStatus: 'not_compared',
			evidenceSelection: 'latest_verification_scan_preferred'
		});
		expect(result.value.archives[0]).toMatchObject({
			archiveUrl: 'https://clean.example.com',
			comparisonStatus: 'not_compared',
			stellarAtlas: {
				archiveEvidenceStatus: 'no_archive_error_observed',
				archiveVerificationErrorCount: 0,
				archiveVerificationErrors: [],
				workerEvidenceStatus: 'no_worker_issue_observed',
				workerIssueCount: 0,
				workerIssues: [],
				hasArchiveVerificationError: false,
				hasWorkerIssue: false
			},
			radarComparison: {
				sourceId: 'withobsrvr-radar',
				probe: 'not_run',
				comparisonStatus: 'not_compared'
			}
		});
		expect(result.value.archives[1]).toMatchObject({
			archiveUrl: 'https://archive-error.example.com',
			stellarAtlas: {
				archiveEvidenceStatus: 'archive_verification_error',
				archiveVerificationErrorCount: 1,
				archiveVerificationErrors: [
					{
						message: 'Wrong ledger hash',
						url: 'https://archive-error.example.com/ledger.xdr.gz'
					}
				],
				workerEvidenceStatus: 'no_worker_issue_observed',
				workerIssueCount: 0,
				hasArchiveVerificationError: true,
				hasWorkerIssue: false
			}
		});
		expect(result.value.archives[2]).toMatchObject({
			archiveUrl: 'https://worker-only.example.com',
			stellarAtlas: {
				archiveEvidenceStatus: 'no_archive_error_observed',
				archiveVerificationErrorCount: 0,
				archiveVerificationErrors: [],
				workerEvidenceStatus: 'worker_issue',
				workerIssueCount: 1,
				workerIssues: [
					{
						message: 'Could not fetch latest ledger',
						url: 'https://worker-only.example.com'
					}
				],
				hasArchiveVerificationError: false,
				hasWorkerIssue: true
			}
		});
		expect(result.value.archives[3]).toMatchObject({
			archiveUrl: 'https://mixed.example.com',
			stellarAtlas: {
				archiveEvidenceStatus: 'archive_verification_error',
				archiveVerificationErrorCount: 1,
				workerEvidenceStatus: 'worker_issue',
				workerIssueCount: 1,
				hasArchiveVerificationError: true,
				hasWorkerIssue: true,
				isSlowArchive: true
			}
		});
		expect(getArchiveScans.execute).toHaveBeenCalledWith({ limit: 4 });
	});

	it('should propagate archive scan read errors', async () => {
		const error = new Error('database unavailable');
		getArchiveScans.execute.mockResolvedValue(err(error));

		const result = await getCrossCheckArchives.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});
