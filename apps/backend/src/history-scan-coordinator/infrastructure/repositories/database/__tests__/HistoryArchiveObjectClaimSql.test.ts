import {
	historyArchiveObjectClaimAdoptionSql,
	historyArchiveObjectClaimCleanupSql,
	historyArchiveObjectClaimFallbackLockSql,
	historyArchiveObjectClaimSql
} from '../HistoryArchiveObjectClaimSql.js';
import { admitCanonicalFrontierSql } from '../HistoryArchiveCanonicalFrontierSql.js';
import { historyArchiveObjectFrontierSql } from '../HistoryArchiveObjectFrontierSql.js';
import {
	buildHistoryArchiveReadyPressureSql,
	historyArchiveCheckpointNotFoundCooldownSql,
	historyArchiveReadyPressureSql
} from '../HistoryArchiveObjectReadyQueue.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('HistoryArchiveObjectClaimSql', () => {
	it('never blocks a root because another checkpoint returned 404', () => {
		expect(historyArchiveCheckpointNotFoundCooldownSql('candidate')).toBe(
			'true'
		);
	});

	it('claims from the compact ready queue under durable slot locks', () => {
		expect(historyArchiveObjectClaimCleanupSql).toContain(
			'update "history_archive_object_claim_slot" slot'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'from "history_archive_object_ready" ready'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'for update of slot skip locked'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'for update of ready, candidate, root skip locked'
		);
		expect(historyArchiveObjectClaimCleanupSql).toContain(
			'pg_try_advisory_xact_lock_shared'
		);
		expect(historyArchiveObjectClaimAdoptionSql).toContain(
			'for update of slot skip locked'
		);
		expect(historyArchiveObjectClaimFallbackLockSql).toContain(
			'pg_advisory_xact_lock'
		);
		expect(historyArchiveObjectClaimFallbackLockSql).not.toContain('try');
	});

	it('keeps proof work ahead of generic work', () => {
		expect(historyArchiveObjectClaimSql).toContain('ready.priority');
		expect(admitCanonicalFrontierSql).toContain(
			'generic_replacements as materialized'
		);
		expect(admitCanonicalFrontierSql).toContain(
			'canonical_reservation_state as materialized'
		);
		expect(admitCanonicalFrontierSql).not.toContain(
			'generic."archiveUrlIdentity" = desired."archiveUrlIdentity"'
		);
	});

	it('revalidates root, host, retry, and dependency gates at claim time', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'active_claims as materialized'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'active."remoteId" = occupied."objectRemoteId"'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(archive_activity.count, 0) < $2'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(host_activity.count, 0) < $4'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'from "history_archive_object_host_throttle" throttle'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."dependencyReady" = true'
		);
		expect(historyArchiveObjectClaimSql).not.toContain('jsonb_array_elements');
	});

	it('keeps canonical reservations focused on proof convergence', () => {
		const stableSourceOrder =
			'order by proof_progress desc,\n\t\t\t\t\t"lastClaimedAt" asc nulls first,\n\t\t\t\t\t"archiveUrlIdentity", object_priority, id';
		expect(admitCanonicalFrontierSql).toContain(stableSourceOrder);
	});

	it('caps per-root capacity probes instead of counting every queued row', () => {
		expect(historyArchiveObjectFrontierSql).toContain(
			'cross join lateral (\n\t\t\tselect count(*)::integer as count'
		);
		expect(historyArchiveObjectFrontierSql).toContain('bounded_runnable');
		expect(historyArchiveObjectFrontierSql).not.toContain(
			'$2::integer - (\n\t\t\t\tselect count(*)::integer'
		);
	});

	it('only wraps a frontier cursor after its descending probe is exhausted', () => {
		expect(historyArchiveObjectFrontierSql).toContain(
			'and continued_candidate.id is null'
		);
		expect(historyArchiveObjectFrontierSql).not.toContain(
			'order by sought.phase'
		);
	});

	it('rotates one file-type cursor per source within the admission limit', () => {
		expect(historyArchiveObjectFrontierSql).toContain(
			'root_attempts as materialized'
		);
		expect(historyArchiveObjectFrontierSql).toContain(
			'order by cursor."updatedAt" asc'
		);
		expect(historyArchiveObjectFrontierSql).toContain(
			'limit greatest($1::integer, 1)'
		);
		expect(historyArchiveObjectFrontierSql).toContain(
			'when candidate.id is null then false'
		);
	});

	it('counts only the canonical root while canonical-first mode is incomplete', () => {
		const sql = buildHistoryArchiveReadyPressureSql(2, '$3::text');
		expect(sql).toContain('canonical_scope as materialized');
		expect(sql).toContain('object."archiveUrlIdentity" = $3::text');
		expect(sql).toContain('not (select incomplete from canonical_scope)');
	});

	it('allows failed retries only on the twelve even slots', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			"free_slot.slot % 2 = 0 and candidate.status = 'failed'"
		);
	});

	it('updates durable root and object cursors', () => {
		expect(historyArchiveObjectClaimSql).toContain('"lastClaimedAt" = now()');
		expect(historyArchiveObjectClaimSql).toContain('root_cursor_update as');
	});

	it('resets transient worker and error state when claiming an object', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'attempts = candidate.attempts + 1'
		);
		expect(historyArchiveObjectClaimSql).toContain('"bytesDownloaded" = null');
		expect(historyArchiveObjectClaimSql).toContain(
			'"workerStage" = \'claimed\''
		);
		expect(historyArchiveObjectClaimSql).toContain('"errorType" = null');
		expect(historyArchiveObjectClaimSql).toContain('"errorMessage" = null');
		expect(historyArchiveObjectClaimSql).toContain('"httpStatus" = null');
		expect(historyArchiveObjectClaimSql).toContain('"nextAttemptAt" = null');
		expect(historyArchiveObjectClaimSql).toContain(
			'"verificationFacts" = null'
		);
	});

	it('does not overwrite terminal transition work before reconciliation', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."transitionEffectsRequiredAt" is null'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."transitionEffectsCompletedAt" is not null'
		);
	});

	it('computes worker pressure only from slots and the compact ready queue', () => {
		expect(historyArchiveReadyPressureSql).toContain(
			'from "history_archive_object_claim_slot" slot'
		);
		expect(historyArchiveReadyPressureSql).toContain(
			'from "history_archive_object_ready"'
		);
		expect(historyArchiveReadyPressureSql).toContain(
			'from "history_archive_object_queue"'
		);
		expect(historyArchiveReadyPressureSql).toContain('"verifiedAt" >=');
		expect(historyArchiveReadyPressureSql).not.toContain(
			'from "history_archive_object_event"'
		);
		expect(historyArchiveReadyPressureSql).not.toContain(
			'candidate."executionDisposition"'
		);
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
		expect(querySource).toContain("'legacy-deferred'");
		expect(querySource).toContain("'missing-dependency'");
		expect(querySource).toContain("'planning-deferred'");
	});

	it('keeps delay reasons off verified rows while explaining retry blockers', () => {
		expect(querySource).toContain(
			"when archive_object.status not in ('pending', 'failed')"
		);
		expect(querySource).toContain(
			"when archive_object.status = 'pending' and not coalesce("
		);
		expect(querySource).toContain(
			"historyArchiveObjectDependencySatisfiedSql('archive_object')"
		);
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
