import { historyArchiveInconclusiveMaximumAttempts } from '../../../domain/history-archive-object/HistoryArchiveInconclusiveRetry.js';
import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';

// Only use alongside an existing ready row: this preserves an already-admitted
// interrupted delivery, never discovers or opens a future checkpoint cohort.
export function historyArchiveRetainedInconclusiveRetrySql(
	alias: string
): string {
	return `(${alias}.status = 'failed'
		and ${alias}.attempts < ${historyArchiveInconclusiveMaximumAttempts}
		and ${alias}."nextAttemptAt" is not null
		and ${historyArchiveInconclusiveTransportFailureSql(alias)})`;
}
