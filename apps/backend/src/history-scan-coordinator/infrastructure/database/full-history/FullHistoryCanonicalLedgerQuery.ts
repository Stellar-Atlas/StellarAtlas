import type { DataSource } from 'typeorm';
import {
	validateFullHistoryLedgerRangeQuery,
	type FullHistoryCanonicalLedgerView,
	type FullHistoryLedgerRangeQuery,
	type FullHistoryLedgerRangeView
} from '../../../domain/full-history/FullHistoryCanonicalLedger.js';
import {
	assertInteger,
	assertUuid,
	FullHistoryHash,
	fullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface FullHistoryLedgerRow {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly bucketListHash: Uint8Array;
	readonly checkpointLedger: string;
	readonly checkpointProofId: number;
	readonly closedAt: Date | string;
	readonly decoderVersion: string;
	readonly ingestedAt: Date | string;
	readonly ledgerHash: Uint8Array;
	readonly ledgerSequence: string;
	readonly ledgerSourceContentDigest: Uint8Array;
	readonly ledgerSourceObjectRemoteId: string;
	readonly operationCount: string;
	readonly previousLedgerHash: Uint8Array;
	readonly proofEvaluatedAt: Date | string;
	readonly proofVersion: number;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultHash: Uint8Array;
	readonly transactionSetHash: Uint8Array;
}

export async function findCanonicalLedgerRange(
	dataSource: DataSource,
	networkHash: FullHistoryHash,
	query: FullHistoryLedgerRangeQuery
): Promise<FullHistoryLedgerRangeView> {
	validateFullHistoryLedgerRangeQuery(query);
	const rows = await dataSource.query<FullHistoryLedgerRow[]>(
		`
			select
				batch."archive_url_identity" as "archiveUrlIdentity",
				batch.id as "batchId",
				ledger."bucket_list_hash" as "bucketListHash",
				batch."checkpoint_ledger"::text as "checkpointLedger",
				batch."checkpoint_proof_id" as "checkpointProofId",
				ledger."closed_at" as "closedAt",
				batch."decoder_version" as "decoderVersion",
				batch."ingested_at" as "ingestedAt",
				ledger."ledger_hash" as "ledgerHash",
				ledger."ledger_sequence"::text as "ledgerSequence",
				batch."ledger_content_digest" as "ledgerSourceContentDigest",
				batch."ledger_object_remote_id" as
					"ledgerSourceObjectRemoteId",
				coalesce(operation_count.value, 0)::text as "operationCount",
				ledger."previous_ledger_hash" as "previousLedgerHash",
				batch."proof_evaluated_at" as "proofEvaluatedAt",
				batch."proof_version" as "proofVersion",
				ledger."protocol_version" as "protocolVersion",
				ledger."transaction_count" as "transactionCount",
				ledger."transaction_result_hash" as "transactionResultHash",
				ledger."transaction_set_hash" as "transactionSetHash"
			from "full_history_ledger" ledger
			join "full_history_ingestion_batch" batch
				on batch.id = ledger."batch_id"
				and batch."network_passphrase_hash" =
					ledger."network_passphrase_hash"
			left join lateral (
				select sum(tx."operation_count") as value
				from "full_history_transaction" tx
				where tx."network_passphrase_hash" =
					ledger."network_passphrase_hash"
					and tx."ledger_sequence" = ledger."ledger_sequence"
			) operation_count on true
			where ledger."network_passphrase_hash" = $1
				and ledger."ledger_sequence" between $2 and $3
			order by ledger."ledger_sequence"
		`,
		[networkHash.toBuffer(), query.firstLedger, query.lastLedger]
	);
	return { records: rows.map(mapLedgerRow) };
}

function mapLedgerRow(
	row: FullHistoryLedgerRow
): FullHistoryCanonicalLedgerView {
	return {
		bucketListHash: FullHistoryHash.fromBytes(row.bucketListHash),
		closedAt: readDate(row.closedAt, 'closedAt'),
		evidence: {
			archiveUrlIdentity: row.archiveUrlIdentity,
			batchId: assertUuid(row.batchId, 'batchId'),
			checkpointLedger: fullHistoryLedgerSequence(
				row.checkpointLedger,
				'checkpointLedger'
			),
			checkpointProofId: assertInteger(
				row.checkpointProofId,
				'checkpointProofId',
				1
			),
			decoderVersion: row.decoderVersion,
			ingestedAt: readDate(row.ingestedAt, 'ingestedAt'),
			ledgerSourceObject: {
				contentDigest: FullHistoryHash.fromBytes(row.ledgerSourceContentDigest),
				objectRemoteId: assertUuid(
					row.ledgerSourceObjectRemoteId,
					'ledgerSourceObjectRemoteId'
				)
			},
			proofEvaluatedAt: readDate(row.proofEvaluatedAt, 'proofEvaluatedAt'),
			proofVersion: assertInteger(row.proofVersion, 'proofVersion', 1)
		},
		ledgerHash: FullHistoryHash.fromBytes(row.ledgerHash),
		ledgerSequence: fullHistoryLedgerSequence(
			row.ledgerSequence,
			'ledgerSequence'
		),
		operationCount: readCount(row.operationCount, 'operationCount'),
		previousLedgerHash: FullHistoryHash.fromBytes(row.previousLedgerHash),
		protocolVersion: assertInteger(row.protocolVersion, 'protocolVersion', 1),
		transactionCount: assertInteger(
			row.transactionCount,
			'transactionCount',
			0
		),
		transactionResultHash: FullHistoryHash.fromBytes(row.transactionResultHash),
		transactionSetHash: FullHistoryHash.fromBytes(row.transactionSetHash)
	};
}

function readCount(value: string, field: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new RangeError(`${field} is outside the safe count range`);
	}
	return parsed;
}

function readDate(value: Date | string, field: string): Date {
	const date =
		value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new TypeError(`PostgreSQL returned an invalid ${field}`);
	}
	return date;
}
