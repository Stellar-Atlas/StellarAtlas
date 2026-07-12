import { mock } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import type { FullHistoryCanonicalRepository } from '../../../../domain/full-history/FullHistoryCanonicalRepository.js';
import { fullHistoryUint64 } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryPromotionFrontierRepository } from '../TypeOrmFullHistoryPromotionFrontierRepository.js';

describe('TypeOrmFullHistoryPromotionFrontierRepository', () => {
	it('selects only the checkpoint immediately after the canonical watermark', async () => {
		const dataSource = mock<DataSource>();
		dataSource.query.mockResolvedValue([
			{ archiveUrlIdentity: 'https://archive.example' }
		]);
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getWatermark.mockResolvedValue({
			lastBatchId: '00000000-0000-8000-8000-000000000001',
			nextLedger: fullHistoryUint64(63386304n, 'nextLedger'),
			updatedAt: new Date('2026-07-12T00:00:00.000Z')
		});
		const result = await new TypeOrmFullHistoryPromotionFrontierRepository(
			dataSource,
			canonical
		).find('Public network', 8);
		expect(result.checkpointLedger).toBe(63386367);
		expect(result.targets).toEqual([
			{
				archiveUrlIdentity: 'https://archive.example',
				checkpointLedger: 63386367,
				networkPassphrase: 'Public network'
			}
		]);
		expect(dataSource.query).toHaveBeenCalledWith(
			expect.stringMatching(
				/proof\.status = 'verified'[\s\S]+proof\."ledgerFactCount"[\s\S]+required\.representation[\s\S]+verificationFacts/
			),
			[63386367, 'Public network', '00000000-0000-8000-8000-000000000001', 8]
		);
	});

	it('requires an explicit bootstrap when no canonical watermark exists', async () => {
		const dataSource = mock<DataSource>();
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getWatermark.mockResolvedValue(null);
		await expect(
			new TypeOrmFullHistoryPromotionFrontierRepository(
				dataSource,
				canonical
			).find('Public network', 8)
		).resolves.toEqual({
			checkpointLedger: null,
			nextLedger: null,
			targets: []
		});
		expect(dataSource.query).not.toHaveBeenCalled();
	});
});
