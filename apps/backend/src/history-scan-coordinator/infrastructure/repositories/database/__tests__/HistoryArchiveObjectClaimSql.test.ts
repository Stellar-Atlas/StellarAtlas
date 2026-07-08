import { historyArchiveObjectClaimSql } from '../HistoryArchiveObjectClaimSql.js';

describe('HistoryArchiveObjectClaimSql', () => {
	it('prioritizes category and bucket checks before more checkpoint discovery', () => {
		const checkpointPriorities = Array.from(
			historyArchiveObjectClaimSql.matchAll(
				/when candidate\."objectType" = 'checkpoint-state' then (?<priority>\d)/g
			),
			(match) => match.groups?.priority
		);

		expect(checkpointPriorities).toEqual(['2', '2', '2']);
		expect(historyArchiveObjectClaimSql).toContain(
			'when candidate."objectType" = \'history-archive-state\' then 0'
		);
		expect(historyArchiveObjectClaimSql).toContain('else 1');
		expect(historyArchiveObjectClaimSql).not.toContain(
			'when candidate."objectType" = \'checkpoint-state\' then 1'
		);
	});
});
