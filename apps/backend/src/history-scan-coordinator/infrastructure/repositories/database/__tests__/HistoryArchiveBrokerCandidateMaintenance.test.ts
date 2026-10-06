import type { EntityManager } from 'typeorm';
import {
	HistoryArchiveBrokerCandidateProjection,
	hydrateHistoryArchiveBrokerCandidatesSql,
	cleanupHistoryArchiveBrokerCandidatesSql
} from '../HistoryArchiveBrokerCandidateProjection.js';

describe('broker projection maintenance separation', () => {
	it('hydrates before each reservation without any orphan cleanup query', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ hydrated: 1, cursor: 'first' }])
			.mockResolvedValueOnce([{ hydrated: 0, cursor: null }]);
		const projection = new HistoryArchiveBrokerCandidateProjection();
		const manager = { query } as unknown as EntityManager;
		await projection.hydrate(manager, 120);
		await projection.hydrate(manager, 120);
		expect(query.mock.calls).toEqual([
			[hydrateHistoryArchiveBrokerCandidatesSql, [null, 120]],
			[hydrateHistoryArchiveBrokerCandidatesSql, ['first', 120]]
		]);
	});
	it('runs only the existing bounded orphan SQL during periodic cleanup', async () => {
		const query = jest.fn().mockResolvedValue([{ deleted: 512 }]);
		const projection = new HistoryArchiveBrokerCandidateProjection();
		await expect(
			projection.cleanup({ query } as unknown as EntityManager)
		).resolves.toBeUndefined();
		expect(query.mock.calls).toEqual([
			[cleanupHistoryArchiveBrokerCandidatesSql]
		]);
	});
});
