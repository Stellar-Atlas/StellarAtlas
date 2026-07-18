import { mock } from 'jest-mock-extended';
import type { EntityManager } from 'typeorm';
import { findLatestScpAnimationSlots } from '../ScpStatementAnimationQuery.js';

describe('ScpStatementAnimationQuery', () => {
	it('ranks one signer and phase representative before bounded extras', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValue([]);

		await findLatestScpAnimationSlots(manager, 4, 251);

		expect(manager.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'partition by observation."slotIndex", observation."nodeId"'
			),
			[4, 251]
		);
		expect(manager.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'case when observation."phaseRank" = 1 then 0 else 1 end'
			),
			[4, 251]
		);
	});

	it('caps direct callers at the hard compact query ceiling', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValue([]);

		await findLatestScpAnimationSlots(manager, 500, 50_000);

		expect(manager.query).toHaveBeenCalledWith(expect.any(String), [25, 4_001]);
	});
});
