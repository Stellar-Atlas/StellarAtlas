import { quoteHubbleIdentifier } from './HubbleSemanticWarehouse.js';

/** Resolve the latest status before filtering; an earlier completion cannot
 * publish a failed/retrying batch. Digest matching also excludes old sources.
 * Aggregate only the small batch catalog, never the warehouse fact tables.
 */
export function completedHubbleBatchPredicate(database: string): string {
	return `(_batch_id, _source_sha256) IN (
	SELECT batch_id,
		tupleElement(argMax(tuple(status, source_sha256), updated_at), 2)
	FROM ${quoteHubbleIdentifier(database)}._ingestion_batches
	GROUP BY batch_id
	HAVING tupleElement(argMax(tuple(status, source_sha256), updated_at), 1) = 'complete'
)`;
}
