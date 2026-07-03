import type {
	CrossCheckArchiveDTO,
	CrossCheckArchiveEvidenceDTO
} from '../../../domain/CrossCheckArchive.js';
import type {
	CrossCheckRadarArchiveSourceRowDTO,
	CrossCheckRadarArchiveSourceSnapshotDTO,
	CrossCheckStellarAtlasArchiveRowsDTO
} from '../../../domain/CrossCheckRadarArchiveComparison.js';
import type { RadarHistoryArchiveScanDTO } from '../../../domain/RadarHistoryArchiveScan.js';
import { CompareRadarArchiveSnapshot } from '../CompareRadarArchiveSnapshot.js';

describe('CompareRadarArchiveSnapshot', () => {
	it('should compare archive record presence by normalized archive URL', () => {
		const useCase = new CompareRadarArchiveSnapshot(
			() => new Date('2026-07-03T16:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSource([
				createRadarRow({
					archiveUrl: 'https://clean.example.com/',
					scan: createRadarScan({ url: 'https://clean.example.com' })
				}),
				createRadarRow({
					archiveUrl: 'https://worker-only.example.com',
					scan: createRadarScan({ url: 'https://worker-only.example.com' })
				}),
				createRadarRow({
					archiveUrl: 'https://source-missing.example.com',
					scan: null
				}),
				createRadarRow({
					archiveUrl: 'https://radar-only.example.com',
					scan: createRadarScan({ url: 'https://radar-only.example.com' })
				})
			]),
			stellarAtlas: createStellarAtlasRows([
				createArchiveRow({ archiveUrl: 'https://clean.example.com' }),
				createArchiveRow({
					archiveUrl: 'https://source-missing.example.com',
					stellarAtlas: createArchiveEvidence({
						archiveVerificationErrorCount: 1,
						archiveVerificationErrors: [
							{
								message: 'Wrong transaction hash',
								url: 'https://source-missing.example.com/transactions.xdr.gz'
							}
						],
						archiveEvidenceStatus: 'archive_verification_error',
						hasArchiveVerificationError: true
					})
				}),
				createArchiveRow({
					archiveUrl: 'https://worker-only.example.com',
					stellarAtlas: createArchiveEvidence({
						hasWorkerIssue: true,
						workerEvidenceStatus: 'worker_issue',
						workerIssueCount: 1,
						workerIssues: [
							{
								message: 'Could not fetch latest ledger',
								url: 'https://worker-only.example.com'
							}
						]
					})
				}),
				createArchiveRow({ archiveUrl: 'https://not-loaded.example.com' })
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T16:00:00.000Z',
			source: {
				archiveCount: 4,
				noScanCount: 1,
				observedAt: '2026-07-03T15:00:00.000Z',
				scanCount: 3,
				sourceId: 'withobsrvr-radar'
			},
			stellarAtlas: {
				archiveCount: 4,
				evidenceSelection: 'latest_verification_scan_preferred',
				observedAt: '2026-07-03T15:05:00.000Z',
				sourceId: 'stellaratlas-api'
			},
			summary: {
				archiveCount: 5,
				fieldMismatchCount: 0,
				matchedCount: 2,
				notLoadedCount: 1,
				sourceMissingCount: 1,
				stellarAtlasMissingCount: 1,
				totalCount: 5
			},
			warnings: []
		});
		expect(
			result.value.archives.map((archive) => ({
				key: archive.key,
				lookup: archive.sourceLookupStatus,
				status: archive.comparisonStatus
			}))
		).toEqual([
			{
				key: 'https://clean.example.com',
				lookup: 'found',
				status: 'matched'
			},
			{
				key: 'https://not-loaded.example.com',
				lookup: 'not_loaded',
				status: 'not_loaded'
			},
			{
				key: 'https://radar-only.example.com',
				lookup: 'found',
				status: 'stellaratlas_missing'
			},
			{
				key: 'https://source-missing.example.com',
				lookup: 'not_found',
				status: 'source_missing'
			},
			{
				key: 'https://worker-only.example.com',
				lookup: 'found',
				status: 'matched'
			}
		]);
	});

	it('should report archive verification field mismatches', () => {
		const useCase = new CompareRadarArchiveSnapshot(
			() => new Date('2026-07-03T16:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSource([
				createRadarRow({
					archiveUrl: 'https://archive.example.com',
					scan: createRadarScan({
						errorMessage: 'Wrong ledger hash',
						errorUrl: 'https://archive.example.com/ledger.xdr.gz',
						hasError: true,
						isSlow: false,
						latestVerifiedLedger: 127,
						url: 'https://archive.example.com'
					})
				})
			]),
			stellarAtlas: createStellarAtlasRows([
				createArchiveRow({
					archiveUrl: 'https://archive.example.com',
					stellarAtlas: createArchiveEvidence({
						isSlowArchive: true,
						latestVerifiedLedger: 255
					})
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.summary).toMatchObject({
			fieldMismatchCount: 1,
			matchedCount: 0,
			totalCount: 1
		});
		expect(result.value.archives[0]).toMatchObject({
			comparisonStatus: 'field_mismatch',
			key: 'https://archive.example.com',
			fieldMismatches: [
				{
					field: 'hasArchiveVerificationError',
					sourceValue: true,
					stellarAtlasValue: false
				},
				{
					field: 'latestVerifiedLedger',
					sourceValue: 127,
					stellarAtlasValue: 255
				},
				{
					field: 'isSlowArchive',
					sourceValue: false,
					stellarAtlasValue: true
				},
				{
					field: 'archiveVerificationErrorUrls',
					sourceValue: ['https://archive.example.com/ledger.xdr.gz'],
					stellarAtlasValue: []
				},
				{
					field: 'archiveVerificationErrorMessages',
					sourceValue: ['Wrong ledger hash'],
					stellarAtlasValue: []
				}
			]
		});
	});

	it('should preserve null RADAR optional evidence and compare multiple StellarAtlas errors', () => {
		const useCase = new CompareRadarArchiveSnapshot(
			() => new Date('2026-07-03T16:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSource([
				createRadarRow({
					archiveUrl: 'https://archive.example.com',
					scan: createRadarScan({
						errorMessage: null,
						errorUrl: null,
						hasError: true,
						isSlow: null,
						latestVerifiedLedger: null,
						url: 'https://archive.example.com'
					})
				})
			]),
			stellarAtlas: createStellarAtlasRows([
				createArchiveRow({
					archiveUrl: 'https://archive.example.com',
					stellarAtlas: createArchiveEvidence({
						archiveEvidenceStatus: 'archive_verification_error',
						archiveVerificationErrorCount: 2,
						archiveVerificationErrors: [
							{
								message: 'Wrong bucket hash',
								url: 'https://archive.example.com/bucket.xdr.gz'
							},
							{
								message: 'Wrong ledger hash',
								url: 'https://archive.example.com/ledger.xdr.gz'
							}
						],
						hasArchiveVerificationError: true,
						latestVerifiedLedger: 127
					})
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.archives[0]).toMatchObject({
			comparisonStatus: 'field_mismatch',
			fieldMismatches: [
				{
					field: 'latestVerifiedLedger',
					sourceValue: null,
					stellarAtlasValue: 127
				},
				{ field: 'isSlowArchive', sourceValue: null, stellarAtlasValue: false },
				{
					field: 'archiveVerificationErrorUrls',
					sourceValue: [],
					stellarAtlasValue: [
						'https://archive.example.com/bucket.xdr.gz',
						'https://archive.example.com/ledger.xdr.gz'
					]
				},
				{
					field: 'archiveVerificationErrorMessages',
					sourceValue: [],
					stellarAtlasValue: ['Wrong bucket hash', 'Wrong ledger hash']
				}
			]
		});
	});

	it('should warn on duplicate normalized archive URLs and use the last row', () => {
		const useCase = new CompareRadarArchiveSnapshot(
			() => new Date('2026-07-03T16:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSource([
				createRadarRow({
					archiveUrl: 'https://same.example.com/',
					scan: createRadarScan({
						hasError: false,
						url: 'https://same.example.com'
					})
				}),
				createRadarRow({
					archiveUrl: 'https://same.example.com',
					scan: createRadarScan({
						errorMessage: 'Wrong bucket hash',
						errorUrl: 'https://same.example.com/bucket.xdr.gz',
						hasError: true,
						url: 'https://same.example.com'
					})
				})
			]),
			stellarAtlas: createStellarAtlasRows([
				createArchiveRow({ archiveUrl: 'https://same.example.com/' }),
				createArchiveRow({
					archiveUrl: 'https://same.example.com',
					stellarAtlas: createArchiveEvidence({
						archiveEvidenceStatus: 'archive_verification_error',
						archiveVerificationErrorCount: 1,
						archiveVerificationErrors: [
							{
								message: 'Wrong bucket hash',
								url: 'https://same.example.com/bucket.xdr.gz'
							}
						],
						hasArchiveVerificationError: true
					})
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.warnings).toEqual([
			'Duplicate RADAR archive key https://same.example.com; last row used',
			'Duplicate StellarAtlas archive key https://same.example.com; last row used'
		]);
		expect(result.value.archives).toHaveLength(1);
		expect(result.value.archives[0]).toMatchObject({
			comparisonStatus: 'matched',
			key: 'https://same.example.com',
			sourceLookupStatus: 'found'
		});
	});
});

function createRadarSource(
	rows: readonly CrossCheckRadarArchiveSourceRowDTO[]
): CrossCheckRadarArchiveSourceSnapshotDTO {
	return {
		generatedAt: '2026-07-03T15:00:00.000Z',
		rows,
		sourceId: 'withobsrvr-radar'
	};
}

function createRadarRow(
	overrides: Partial<CrossCheckRadarArchiveSourceRowDTO> = {}
): CrossCheckRadarArchiveSourceRowDTO {
	return {
		archiveUrl: 'https://history.example.com',
		scan: createRadarScan(),
		...overrides
	};
}

function createRadarScan(
	overrides: Partial<RadarHistoryArchiveScanDTO> = {}
): RadarHistoryArchiveScanDTO {
	return {
		contentHashSha256: 'fixture-hash',
		endDate: '2026-07-03T14:01:00.000Z',
		endpointUrl:
			'https://radar.withobsrvr.com/api/v1/history-scan/https%3A%2F%2Fhistory.example.com',
		errorMessage: null,
		errorUrl: null,
		fetchedAt: '2026-07-03T14:02:00.000Z',
		hasError: false,
		isSlow: false,
		latestVerifiedLedger: 127,
		sourceId: 'withobsrvr-radar',
		startDate: '2026-07-03T14:00:00.000Z',
		url: 'https://history.example.com',
		...overrides
	};
}

function createStellarAtlasRows(
	archives: readonly CrossCheckArchiveDTO[]
): CrossCheckStellarAtlasArchiveRowsDTO {
	return {
		archives,
		count: archives.length,
		evidenceSelection: 'latest_verification_scan_preferred',
		generatedAt: '2026-07-03T15:05:00.000Z'
	};
}

function createArchiveRow(
	overrides: Partial<CrossCheckArchiveDTO> = {}
): CrossCheckArchiveDTO {
	const stellarAtlas = overrides.stellarAtlas ?? createArchiveEvidence();
	return {
		archiveUrl: 'https://history.example.com',
		comparisonStatus: 'not_compared',
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas,
		...overrides
	};
}

function createArchiveEvidence(
	overrides: Partial<CrossCheckArchiveEvidenceDTO> = {}
): CrossCheckArchiveEvidenceDTO {
	return {
		archiveEvidenceStatus: 'no_archive_error_observed',
		archiveVerificationErrorCount: 0,
		archiveVerificationErrors: [],
		hasArchiveVerificationError: false,
		hasWorkerIssue: false,
		isSlowArchive: false,
		latestVerifiedLedger: 127,
		scanCompletedAt: '2026-07-03T14:01:00.000Z',
		scanStartedAt: '2026-07-03T14:00:00.000Z',
		workerEvidenceStatus: 'no_worker_issue_observed',
		workerIssueCount: 0,
		workerIssues: [],
		...overrides
	};
}
