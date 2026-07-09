import {
	historyArchiveObjectClaimLockSql,
	historyArchiveObjectClaimSql
} from '../HistoryArchiveObjectClaimSql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('HistoryArchiveObjectClaimSql', () => {
	it('uses an advisory transaction lock around object claiming', () => {
		expect(historyArchiveObjectClaimLockSql).toBe(
			'select pg_try_advisory_xact_lock(hashtext($1)) as locked'
		);
	});

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

	it('applies total, archive, host, retry, and host-backoff gates before claim', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'active_total.active_count < $3'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(active_archive.active_count, 0) < $2'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(active_host.active_count, 0) < $4'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'from history_archive_object_host_throttle'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'where "blockedUntil" > now()'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."nextAttemptAt",'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			"candidate.\"updatedAt\" + interval '1 hour'"
		);
	});

	it('samples broad pending work before retry work so fresh objects can rotate', () => {
		expect(historyArchiveObjectClaimSql).toContain('limit 512');
		expect(historyArchiveObjectClaimSql).toContain('limit 64');
		expect(
			historyArchiveObjectClaimSql.indexOf('pending_candidates as')
		).toBeLessThan(historyArchiveObjectClaimSql.indexOf('failed_candidates as'));
	});

	it('orders object keys before archive identities for source rotation inside each object', () => {
		const orderingClause =
			/"objectOrder" asc,\s*candidate\."objectKey" asc,\s*candidate\."archiveUrlIdentity" asc/;

		expect(historyArchiveObjectClaimSql).toMatch(orderingClause);
	});

	it('resets transient worker and error state when claiming an object', () => {
		expect(historyArchiveObjectClaimSql).toContain('"attempts" = "attempts" + 1');
		expect(historyArchiveObjectClaimSql).toContain('"bytesDownloaded" = null');
		expect(historyArchiveObjectClaimSql).toContain('"workerStage" = \'claimed\'');
		expect(historyArchiveObjectClaimSql).toContain('"errorType" = null');
		expect(historyArchiveObjectClaimSql).toContain('"errorMessage" = null');
		expect(historyArchiveObjectClaimSql).toContain('"httpStatus" = null');
		expect(historyArchiveObjectClaimSql).toContain('"nextAttemptAt" = null');
		expect(historyArchiveObjectClaimSql).toContain('"verificationFacts" = null');
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
