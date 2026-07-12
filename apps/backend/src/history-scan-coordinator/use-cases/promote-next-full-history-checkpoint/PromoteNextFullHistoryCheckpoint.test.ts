import { mock } from 'jest-mock-extended';
import type { FullHistoryPromotionFrontierRepository } from '../../domain/full-history-promotion/FullHistoryPromotionFrontierRepository.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';
import { fullHistoryUint64 } from '../../domain/full-history/FullHistoryCanonicalTypes.js';
import type { PromoteFullHistoryCheckpoint } from '../promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';
import { PromoteNextFullHistoryCheckpoint } from './PromoteNextFullHistoryCheckpoint.js';

const networkPassphrase = 'Test Network ; March 2026';

describe('PromoteNextFullHistoryCheckpoint', () => {
	it('waits for an exact verified proof at the canonical watermark', async () => {
		const frontier = mock<FullHistoryPromotionFrontierRepository>();
		frontier.find.mockResolvedValue({
			checkpointLedger: 191,
			nextLedger: fullHistoryUint64(128n, 'nextLedger'),
			targets: []
		});
		const promoter = mock<PromoteFullHistoryCheckpoint>();
		await expect(
			new PromoteNextFullHistoryCheckpoint(frontier, promoter).execute(
				networkPassphrase
			)
		).resolves.toEqual({
			checkpointLedger: 191,
			nextLedger: '128',
			status: 'proof-pending'
		});
		expect(promoter.promote).not.toHaveBeenCalled();
	});

	it('tries another verified archive source after source-specific evidence fails', async () => {
		const frontier = mock<FullHistoryPromotionFrontierRepository>();
		const first = target('https://archive-a.example', 191);
		const second = target('https://archive-b.example', 191);
		frontier.find.mockResolvedValue({
			checkpointLedger: 191,
			nextLedger: fullHistoryUint64(128n, 'nextLedger'),
			targets: [first, second]
		});
		const promoter = mock<PromoteFullHistoryCheckpoint>();
		promoter.promote
			.mockRejectedValueOnce(
				new FullHistoryPromotionError('candidate-incomplete', 'stale source')
			)
			.mockResolvedValueOnce({
				batchId: '00000000-0000-8000-8000-000000000001',
				nextLedger: fullHistoryUint64(192n, 'nextLedger'),
				replayed: false
			});
		const result = await new PromoteNextFullHistoryCheckpoint(
			frontier,
			promoter
		).execute(networkPassphrase);
		expect(result.status).toBe('promoted');
		expect(promoter.promote).toHaveBeenNthCalledWith(1, first);
		expect(promoter.promote).toHaveBeenNthCalledWith(2, second);
	});

	it('does not bypass canonical repository failures with another source', async () => {
		const frontier = mock<FullHistoryPromotionFrontierRepository>();
		frontier.find.mockResolvedValue({
			checkpointLedger: 191,
			nextLedger: fullHistoryUint64(128n, 'nextLedger'),
			targets: [target('https://archive-a.example', 191)]
		});
		const promoter = mock<PromoteFullHistoryCheckpoint>();
		const failure = new Error('database unavailable');
		promoter.promote.mockRejectedValue(failure);
		await expect(
			new PromoteNextFullHistoryCheckpoint(frontier, promoter).execute(
				networkPassphrase
			)
		).rejects.toBe(failure);
	});
});

function target(archiveUrlIdentity: string, checkpointLedger: number) {
	return { archiveUrlIdentity, checkpointLedger, networkPassphrase } as const;
}
