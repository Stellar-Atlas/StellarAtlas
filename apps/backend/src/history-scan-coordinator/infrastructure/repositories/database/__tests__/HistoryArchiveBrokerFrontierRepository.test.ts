import { reserveBrokerJobsSql } from '../HistoryArchiveBrokerFrontierRepository.js';

describe('HistoryArchiveBrokerFrontierRepository', () => {
	it('admits independent ready objects without deleting a competing priority lane', () => {
		expect(reserveBrokerJobsSql).toContain('from eligible candidate');
		expect(reserveBrokerJobsSql).toContain(
			'ranked.active_count + ranked.host_rank <= $2::integer'
		);
		expect(reserveBrokerJobsSql).toContain(
			'"publishedAt" = coalesce(ready."publishedAt", now())'
		);
		expect(reserveBrokerJobsSql).not.toContain('frozen_lane');
		expect(reserveBrokerJobsSql).not.toContain('deduplicated as materialized');
		expect(reserveBrokerJobsSql).not.toContain('displaced as');
		expect(reserveBrokerJobsSql).not.toContain('displacement_fence');
	});
});
