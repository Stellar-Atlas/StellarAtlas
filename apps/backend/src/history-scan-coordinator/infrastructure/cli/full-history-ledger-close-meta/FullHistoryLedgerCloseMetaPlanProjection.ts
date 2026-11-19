import type { FullHistoryLedgerCloseMetaRange } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaIngestionContext } from '../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import { createShardRanges } from '../../../use-cases/ingest-full-history-ledger-close-meta/FullHistoryLedgerCloseMetaShardRanges.js';
import {
	selectsCompactLedgerEntryChanges,
	type FullHistoryLedgerEntryCompactSelection
} from '../../full-history-ledger-close-meta/FullHistoryLedgerEntryCompactSelection.js';
import type { PendingPlan } from './FullHistoryLedgerCloseMetaPendingPlan.js';

export function createFullHistoryLedgerCloseMetaPendingPlan(
	context: FullHistoryLedgerCloseMetaIngestionContext,
	config: { readonly typedShardLedgerCount: number; readonly compactLedgerEntryChanges?: FullHistoryLedgerEntryCompactSelection },
	range: FullHistoryLedgerCloseMetaRange,
	kind: PendingPlan['kind'],
	projection: FullHistoryLedgerEntryCompactSelection | null | undefined = config.compactLedgerEntryChanges
): PendingPlan {
	const shards = createShardRanges(range, context.config.ledgersPerBatch, config.typedShardLedgerCount)
		.map(shard => ({ startLedger: shard.startSequence, endLedger: shard.endSequence }));
	const selected = projection != null && shards.some(shard =>
		selectsCompactLedgerEntryChanges(projection, shard));
	const legacy = {
		version: 1 as const, kind,
		networkPassphraseHash: context.registeredSource.networkPassphraseHash,
		sourceId: context.registeredSource.sourceId,
		configDigest: context.registeredSource.configDigest,
		partitionVersion: 'source-aligned-remainder-v1' as const,
		sourceBatchLedgerCount: context.config.ledgersPerBatch,
		typedShardLedgerCount: config.typedShardLedgerCount,
		startLedger: range.startSequence, endLedger: range.endSequence, shards
	};
	return selected && projection != null
		? { ...legacy, version: 2, compactLedgerEntryChanges: { ...projection } }
		: legacy;
}

export function contextForFullHistoryLedgerCloseMetaPlan(
	context: FullHistoryLedgerCloseMetaIngestionContext, plan: PendingPlan
): FullHistoryLedgerCloseMetaIngestionContext {
	return { ...context, compactLedgerEntryChanges: plan.version === 2 ? plan.compactLedgerEntryChanges : null };
}
