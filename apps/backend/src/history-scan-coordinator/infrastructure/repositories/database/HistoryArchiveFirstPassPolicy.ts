import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export type HistoryArchiveRetryPhase = 'first-pass' | 'recheck';

/** An operator phase, not a claim that checkpoint samples prove every file was
 * checked. Opening rechecks requires a separately verified catch-up decision. */
export function getHistoryArchiveRetryPhase(
	environment: NodeJS.ProcessEnv = process.env
): HistoryArchiveRetryPhase {
	const phase = environment.HISTORY_ARCHIVE_RETRY_PHASE ?? 'first-pass';
	if (phase !== 'first-pass' && phase !== 'recheck')
		throw new Error(
			'HISTORY_ARCHIVE_RETRY_PHASE must be first-pass or recheck'
		);
	return phase;
}

function requireAlias(alias: string): void {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid first-pass SQL alias');
}

export function historyArchiveNeverAttemptedSql(alias: string): string {
	requireAlias(alias);
	return `(${alias}.status = 'pending' and ${alias}.attempts = 0)`;
}

export function historyArchiveExplicitManualRetrySql(
	objectAlias: string,
	readyAlias: string
): string {
	requireAlias(objectAlias);
	requireAlias(readyAlias);
	return `(${readyAlias}."recheckRequestedAt" is not null
		and ${readyAlias}."dispatchToken" is not null
		and (${readyAlias}."claimAttempt" is null
			or ${readyAlias}."claimAttempt" = ${objectAlias}.attempts + 1))`;
}

/** Recovery is limited to the exact open frontier, not any failed historical
 * file. Existing host/root backoff, lease and proof checks still apply. */
export function historyArchiveBlockingRecoverySql(alias: string): string {
	requireAlias(alias);
	return `(${alias}.attempts > 0
		and ${alias}.status in ('pending', 'failed')
		and ${alias}."dependencyReady" = true
		and ${alias}."executionDisposition" <> 'superseded'
		and (coalesce(${alias}."httpStatus" between 500 and 599, false)
			or ${historyArchiveInconclusiveTransportFailureSql(alias)})
		and exists (
			select 1 from history_archive_checkpoint_scan_cursor recovery_cursor
			where recovery_cursor."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
				and recovery_cursor."nextHistoricalCheckpointLedger" >= 127
				and not exists (
					select 1 from history_archive_checkpoint_proof recovery_proof
					where recovery_proof."archiveUrlIdentity" = recovery_cursor."archiveUrlIdentity"
						and recovery_proof."checkpointLedger" = recovery_cursor."nextHistoricalCheckpointLedger" - 64
						and recovery_proof.status = 'verified'
				)
				and not exists (
					select 1 from history_archive_checkpoint_substitution recovery_substitution
					where recovery_substitution."archiveUrlIdentity" = recovery_cursor."archiveUrlIdentity"
						and recovery_substitution."checkpointLedger" = recovery_cursor."nextHistoricalCheckpointLedger" - 64
				)
				and (
					(${alias}."objectType" in ('checkpoint-state', 'ledger', 'transactions', 'results', 'scp')
						and ${alias}."checkpointLedger" = recovery_cursor."nextHistoricalCheckpointLedger" - 64)
					or (${alias}."objectType" = 'bucket' and exists (
						select 1 from history_archive_object_queue recovery_bucket
						where recovery_bucket."remoteId" = ${alias}."remoteId"
							and exists (select 1 from lateral (
								${historyArchiveCheckpointBucketDependenciesSql('recovery_cursor."archiveUrlIdentity"', 'recovery_cursor."nextHistoricalCheckpointLedger" - 64')}
							) dependency where dependency."bucketHash" = recovery_bucket."bucketHash")
					))
				)
		))`;
}

/** Use only inside an already bounded candidate selection. No global queue
 * reads or summary-counter guesses are needed for the first-pass phase. */
export function historyArchiveFirstPassAllowedSql(
	objectAlias: string,
	readyAlias: string,
	phase: HistoryArchiveRetryPhase = getHistoryArchiveRetryPhase()
): string {
	requireAlias(objectAlias);
	requireAlias(readyAlias);
	if (phase === 'recheck') return 'true';
	return `(${historyArchiveNeverAttemptedSql(objectAlias)}
		or ${objectAlias}."objectType" = 'history-archive-state'
		or ${historyArchiveExplicitManualRetrySql(objectAlias, readyAlias)}
		or ${historyArchiveBlockingRecoverySql(objectAlias)})`;
}
