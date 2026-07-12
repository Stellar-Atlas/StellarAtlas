import {
	estimateOrganizationTomlBackfillPeakBytes,
	ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES,
	OrganizationTomlEvidenceBackfill
} from '../OrganizationTomlEvidenceBackfill.js';

describe('OrganizationTomlEvidenceBackfill capacity', () => {
	it('publishes a conservative bounded peak estimate', () => {
		expect(estimateOrganizationTomlBackfillPeakBytes(25)).toBe(
			114n * 1_024n * 1_024n
		);
		expect(estimateOrganizationTomlBackfillPeakBytes(250)).toBe(
			564n * 1_024n * 1_024n
		);
	});

	it('pauses before opening a database runner when disk reserve is unsafe', async () => {
		const createQueryRunner = jest.fn();
		const peak = estimateOrganizationTomlBackfillPeakBytes(25);

		await expect(
			new OrganizationTomlEvidenceBackfill().runBatch(
				{ createQueryRunner } as never,
				{
					availableBytes:
						ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES + peak - 1n
				}
			)
		).resolves.toEqual({
			completed: false,
			insertedAttempts: 0,
			pauseReason: 'insufficient_disk',
			peakEstimateBytes: peak.toString(),
			processedOrganizations: 0,
			quarantinedRows: 0
		});
		expect(createQueryRunner).not.toHaveBeenCalled();
	});

	it.each([0, 1_001, 1.5])('rejects an unsafe batch size %s', (batchSize) => {
		expect(() => new OrganizationTomlEvidenceBackfill(batchSize)).toThrow(
			'batch size must be 1..1000'
		);
	});
});
