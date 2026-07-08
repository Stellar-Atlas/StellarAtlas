import { historyArchiveObjectClaimSql } from '../HistoryArchiveObjectClaimSql.js';

describe('HistoryArchiveObjectClaimSql', () => {
	it('prioritizes root state, bucket payloads, then checkpoint discovery', () => {
		const checkpointPriorities = Array.from(
			historyArchiveObjectClaimSql.matchAll(
				/when candidate\."objectType" = 'checkpoint-state' then (?<priority>\d)/g
			),
			(match) => match.groups?.priority
		);
		const bucketPriorities = Array.from(
			historyArchiveObjectClaimSql.matchAll(
				/when candidate\."objectType" = 'bucket' then (?<priority>\d)/g
			),
			(match) => match.groups?.priority
		);

		expect(bucketPriorities).toEqual(['1', '1', '1']);
		expect(checkpointPriorities).toEqual(['2', '2', '2']);
		expect(historyArchiveObjectClaimSql).toContain(
			'when candidate."objectType" = \'history-archive-state\' then 0'
		);
		expect(historyArchiveObjectClaimSql).toContain('else 3');
	});
});
