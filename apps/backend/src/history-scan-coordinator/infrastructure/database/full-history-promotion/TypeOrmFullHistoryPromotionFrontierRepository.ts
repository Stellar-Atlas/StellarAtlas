import type { DataSource } from 'typeorm';
import type { FullHistoryCanonicalRepository } from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	fullHistoryUint64,
	type FullHistoryUint64String
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import type {
	FullHistoryPromotionFrontier,
	FullHistoryPromotionFrontierRepository
} from '../../../domain/full-history-promotion/FullHistoryPromotionFrontierRepository.js';
import { fullHistoryStrictProofSourceDigestsSql } from '../full-history/FullHistoryStrictProofSourceSql.js';

interface PromotionTargetRow {
	readonly archiveUrlIdentity: string;
}

const maximumCheckpointLedger = 0xffff_ffffn;

export class TypeOrmFullHistoryPromotionFrontierRepository implements FullHistoryPromotionFrontierRepository {
	constructor(
		private readonly dataSource: DataSource,
		private readonly canonicalRepository: FullHistoryCanonicalRepository
	) {}

	async find(
		networkPassphrase: string,
		maximumTargets: number
	): Promise<FullHistoryPromotionFrontier> {
		if (
			!Number.isInteger(maximumTargets) ||
			maximumTargets < 1 ||
			maximumTargets > 32
		) {
			throw new RangeError('maximumTargets must be between 1 and 32');
		}
		const watermark =
			await this.canonicalRepository.getWatermark(networkPassphrase);
		if (watermark === null) return emptyFrontier();

		const checkpointLedger = checkpointForNextLedger(watermark.nextLedger);
		const rows = (await this.dataSource.query(promotionTargetSql, [
			checkpointLedger,
			networkPassphrase,
			watermark.lastBatchId,
			maximumTargets
		])) as PromotionTargetRow[];
		return {
			checkpointLedger,
			nextLedger: watermark.nextLedger,
			targets: rows.map((row) => ({
				archiveUrlIdentity: row.archiveUrlIdentity,
				checkpointLedger,
				networkPassphrase
			}))
		};
	}
}

function emptyFrontier(): FullHistoryPromotionFrontier {
	return { checkpointLedger: null, nextLedger: null, targets: [] };
}

function checkpointForNextLedger(nextLedger: FullHistoryUint64String): number {
	const next = BigInt(nextLedger);
	if (next !== 1n && next % 64n !== 0n) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			'Canonical full-history watermark is not checkpoint-aligned'
		);
	}
	const checkpoint = next === 1n ? 63n : next + 63n;
	if (checkpoint > maximumCheckpointLedger) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			'Canonical full-history watermark exceeds the supported ledger range'
		);
	}
	fullHistoryUint64(checkpoint, 'checkpointLedger');
	return Number(checkpoint);
}

export const promotionTargetSql = `
	select proof."archiveUrlIdentity"
	from "history_archive_checkpoint_proof" proof
	where proof."checkpointLedger" = $1
		and proof.status = 'verified'
		and proof."proofVersion" >= 6
		and proof."failureKind" is null
		and proof."requiredObjectsComplete"
		and proof."proofFactsComplete"
		and proof."ledgerFactCount" = case
			when proof."checkpointLedger" = 63 then 63 else 64 end
		and proof."transactionFactCount" = case
			when proof."checkpointLedger" = 63 then 63 else 64 end
		and proof."resultFactCount" = case
			when proof."checkpointLedger" = 63 then 63 else 64 end
		and proof."checkpointBucketListMatches"
		and proof."transactionsMatch"
		and proof."resultsMatch"
		and proof."previousLedgersMatch"
		and proof."bucketsVerified"
		and proof."checkpointStateObjectRemoteId" is not null
		and proof."ledgerObjectRemoteId" is not null
		and proof."transactionsObjectRemoteId" is not null
		and proof."resultsObjectRemoteId" is not null
		and proof.details ->> 'checkpointStateLedgerFactPresent' = 'true'
		and proof.details ->> 'checkpointStateLedgerMatches' = 'true'
		and proof.details ->> 'networkPassphrase' = $2
		and ${fullHistoryStrictProofSourceDigestsSql}
	order by
		case when proof."archiveUrlIdentity" = (
			select batch."archive_url_identity"
			from "full_history_ingestion_batch" batch
			where batch.id = $3
		) then 0 else 1 end,
		proof."evaluatedAt" desc,
		proof."archiveUrlIdentity"
	limit $4
`;
