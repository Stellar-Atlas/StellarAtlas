import { historyArchiveObjectClaimSql } from '../HistoryArchiveObjectClaimSql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

describe('HistoryArchiveObjectListQuery', () => {
	const querySource = readFileSync(
		resolve(
			dirname(fileURLToPath(import.meta.url)),
			'../HistoryArchiveObjectListQuery.ts'
		),
		'utf8'
	);

	it('publishes delay reason codes for scheduler blockers', () => {
		expect(querySource).toContain("'object-already-active'");
		expect(querySource).toContain("'host-backoff'");
		expect(querySource).toContain("'retry-window'");
		expect(querySource).toContain("'global-active-cap'");
		expect(querySource).toContain("'archive-active-cap'");
		expect(querySource).toContain("'host-active-cap'");
	});

	it('uses the same active caps as the claim path', () => {
		expect(querySource).toContain('active_total.active_count >= $2');
		expect(querySource).toContain(
			'coalesce(active_archive.active_count, 0) >= $1'
		);
		expect(querySource).toContain(
			'coalesce(active_host.active_count, 0) >= $3'
		);
	});
});
