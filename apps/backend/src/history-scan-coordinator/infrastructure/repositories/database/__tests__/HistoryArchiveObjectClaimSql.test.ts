import {
	historyArchiveObjectClaimAdoptionSql,
	historyArchiveObjectClaimCleanupSql,
	historyArchiveObjectClaimFallbackLockSql,
	historyArchiveObjectClaimFinalizeSql,
	historyArchiveObjectClaimSelectionSql
} from '../HistoryArchiveObjectClaimSql.js';
import { admitCanonicalFrontierSql } from '../HistoryArchiveCanonicalFrontierSql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('HistoryArchiveObjectClaimSql', () => {
	it('selects durable slots under a concurrent shared claim gate', () => {
		expect(historyArchiveObjectClaimCleanupSql).toContain(
			'update "history_archive_object_claim_slot" slot'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'for update of slot skip locked'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'for update of root skip locked'
		);
		expect(historyArchiveObjectClaimSelectionSql).not.toContain(
			'for update of slot, root'
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

	it('prioritizes claim class, proof work, and a fair bounded root', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'claim_class."claimClass"'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			"when 'canonical-frontier-reserve' then 0"
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			"when 'proof-completion-reserve' then 1"
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'when claim_class.slot % 2 = 1 then root_work.priority'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'case when $3::integer % 2 = 1 then case candidate."executionReason"'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'for update of root skip locked'
		);
		expect(
			historyArchiveObjectClaimSelectionSql.indexOf(
				'for update of slot skip locked'
			)
		).toBeLessThan(
			historyArchiveObjectClaimSelectionSql.indexOf('root_work as materialized')
		);
		expect(historyArchiveObjectClaimSelectionSql).not.toContain('limit 512');
	});

	it('can replace generic runnable work globally for the proof frontier', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'when claim_class.slot % 2 = 1 then root_work.priority'
		);
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

	it('bounds candidate lookup by claimable archive roots', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'active_claims as materialized'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'active."remoteId" = occupied."objectRemoteId"'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'claimable_roots as materialized'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'from claimable_roots root'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain('join lateral (');
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'candidate."archiveUrlIdentity" = root."archiveUrlIdentity"'
		);
		expect(historyArchiveObjectClaimSelectionSql).not.toContain(
			'group by candidate."archiveUrlIdentity"'
		);
	});

	it('revalidates archive, host, retry, and host-backoff gates', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain('slot.slot < $3');
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			"and active.status = 'scanning'"
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(') < $2');
		expect(historyArchiveObjectClaimFinalizeSql).toContain(') < $4');
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'from "history_archive_object_host_throttle" throttle'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'throttle."blockedUntil" > now()'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'candidate."nextAttemptAt",'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'candidate."updatedAt" + interval \'1 hour\''
		);
	});

	it('allows failed retries only on the twelve even slots', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'and (class_state."hasPending" or class_state."hasFailed")'
		);
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'when claim_slot.slot % 2 = 0 and class_state."hasFailed"'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			"$8::text = 'failed'"
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'$3::integer % 2 = 0'
		);
		expect(historyArchiveObjectClaimFinalizeSql).not.toContain(
			'coalesce(pending_candidate.id, failed_candidate.id)'
		);
	});

	it('updates durable root and object cursors', () => {
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"lastClaimedAt" = now()'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'root_cursor_update as'
		);
	});

	it('claims only materialized dependency-ready rows', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'candidate."dependencyReady" = true'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'candidate."dependencyReady" = true'
		);
		expect(historyArchiveObjectClaimSelectionSql).not.toContain(
			'jsonb_array_elements'
		);
	});

	it('resets transient worker and error state when claiming an object', () => {
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'attempts = candidate.attempts + 1'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"lastClaimedAt" = now()'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"bytesDownloaded" = null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"workerStage" = \'claimed\''
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"errorType" = null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"errorMessage" = null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"httpStatus" = null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"nextAttemptAt" = null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'"verificationFacts" = null'
		);
	});

	it('does not overwrite terminal transition work before reconciliation', () => {
		expect(historyArchiveObjectClaimSelectionSql).toContain(
			'candidate."transitionEffectsRequiredAt" is null'
		);
		expect(historyArchiveObjectClaimFinalizeSql).toContain(
			'candidate."transitionEffectsCompletedAt" is not null'
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
