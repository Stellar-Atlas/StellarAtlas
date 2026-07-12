import { historyArchiveObjectClaimSql } from '../HistoryArchiveObjectClaimSql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('HistoryArchiveObjectClaimSql', () => {
	it('claims through 24 durable slots without a global steady-state lock', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'from "history_archive_object_claim_slot" slot'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'for update of slot skip locked'
		);
		expect(historyArchiveObjectClaimSql).not.toContain(
			"history_archive_object_claim'"
		);
	});

	it('prioritizes proof work, then seeks a fair bounded root candidate', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'order by priority, root."lastClaimedAt" asc nulls first, root.id'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			"when 'canonical-frontier-reserve' then 0"
		);
		expect(historyArchiveObjectClaimSql).toContain(
			"when 'proof-completion-reserve' then 1"
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'for update of root skip locked'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."lastClaimedAt" asc nulls first'
		);
		expect(historyArchiveObjectClaimSql).not.toContain('limit 512');
	});

	it('applies slot, archive, host, retry, and host-backoff gates', () => {
		expect(historyArchiveObjectClaimSql).toContain('and slot.slot < $3');
		expect(historyArchiveObjectClaimSql).toContain(
			"and active.status = 'scanning'"
		);
		expect(historyArchiveObjectClaimSql).toContain(') < $2');
		expect(historyArchiveObjectClaimSql).toContain(') < $4');
		expect(historyArchiveObjectClaimSql).toContain(
			'from "history_archive_object_host_throttle" throttle'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'throttle."blockedUntil" > now()'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."nextAttemptAt",'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."updatedAt" + interval \'1 hour\''
		);
	});

	it('reserves one quarter of slots for due failed work with fallback', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'when free_slot.slot % 4 = 0'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(failed_candidate.id, pending_candidate.id)'
		);
		expect(historyArchiveObjectClaimSql).toContain(
			'coalesce(pending_candidate.id, failed_candidate.id)'
		);
	});

	it('updates durable root and object cursors', () => {
		expect(historyArchiveObjectClaimSql).toContain('"lastClaimedAt" = now()');
		expect(historyArchiveObjectClaimSql).toContain('root_cursor_update as');
	});

	it('claims only materialized dependency-ready rows', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'candidate."dependencyReady" = true'
		);
		expect(historyArchiveObjectClaimSql).not.toContain('jsonb_array_elements');
	});

	it('resets transient worker and error state when claiming an object', () => {
		expect(historyArchiveObjectClaimSql).toContain(
			'attempts = candidate.attempts + 1'
		);
		expect(historyArchiveObjectClaimSql).toContain('"lastClaimedAt" = now()');
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
		expect(
			historyArchiveObjectClaimSql.match(
				/candidate\."transitionEffectsRequiredAt" is null/g
			)
		).toHaveLength(5);
		expect(
			historyArchiveObjectClaimSql.match(
				/candidate\."transitionEffectsCompletedAt" is not null/g
			)
		).toHaveLength(5);
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

	it('keeps delay reasons off failed and verified terminal rows', () => {
		expect(querySource).toContain("when archive_object.status <> 'pending'");
		expect(querySource).toContain('when not coalesce(');
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
