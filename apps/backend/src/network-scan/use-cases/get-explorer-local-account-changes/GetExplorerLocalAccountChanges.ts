import 'reflect-metadata';
import { StrKey } from '@stellar/stellar-sdk';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import type { NetworkConfig } from '@core/config/Config.js';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type {
	ExplorerLocalAccountChangeDTO,
	ExplorerLocalAccountChangesDTO
} from './ExplorerLocalAccountChangeDTO.js';
import {
	mapExplorerLocalAccountChange,
	mapExplorerLocalAccountLatestCoverage,
	type ExplorerLocalAccountChangeRawRow
} from './ExplorerLocalAccountChangeMapper.js';

export const explorerLocalAccountChangeLimitMaximum = 25;
export const explorerLocalAccountChangeLimitDefault = 1;

export interface ExplorerLocalAccountChangesQuery {
	readonly accountId: string;
	readonly limit: number;
}

@injectable()
export class GetExplorerLocalAccountChanges {
	constructor(
		@inject(DataSource) private readonly dataSource: DataSource,
		@inject(NETWORK_TYPES.NetworkConfig)
		private readonly networkConfig: Pick<NetworkConfig, 'networkPassphrase'>
	) {}

	async execute(
		query: ExplorerLocalAccountChangesQuery
	): Promise<ExplorerLocalAccountChangesDTO> {
		validateExplorerLocalAccountChangesQuery(query);
		const generatedAt = new Date().toISOString();
		const rows = await this.dataSource.query<
			ExplorerLocalAccountChangeRawRow[]
		>(explorerLocalAccountChangesSql, [
			hashNetworkPassphrase(this.networkConfig.networkPassphrase).toBuffer(),
			query.accountId,
			query.limit + 1
		]);
		const base = {
			accountId: query.accountId,
			generatedAt,
			interpretation: 'historical_observations_not_current_state' as const,
			limit: query.limit,
			source: 'postgres_proof_gated_lcm_account_changes' as const
		};
		if (rows.length === 0) {
			return {
				...base,
				count: 0,
				coverage: null,
				reason: 'complete_canonical_coverage_empty',
				records: [],
				status: 'unavailable',
				truncated: false
			};
		}

		const coverage = mapExplorerLocalAccountLatestCoverage(rows[0]!);
		const observedRows = rows.filter((row) => row.hasObservation === true);
		if (observedRows.length === 0) {
			if (rows.length !== 1 || rows[0]?.hasObservation !== false) {
				throw new TypeError('Account observation sentinel row is invalid');
			}
			return {
				...base,
				count: 0,
				coverage,
				reason: 'no_change_observed_in_complete_coverage',
				records: [],
				status: 'not_observed',
				truncated: false
			};
		}
		if (observedRows.length !== rows.length) {
			throw new TypeError(
				'Account observation rows mix evidence and sentinel data'
			);
		}

		const mapped: readonly ExplorerLocalAccountChangeDTO[] = observedRows.map(
			(row) => mapExplorerLocalAccountChange(row, query.accountId)
		);
		const truncated = mapped.length > query.limit;
		const records = mapped.slice(0, query.limit);
		return {
			...base,
			count: records.length,
			coverage,
			records,
			status: 'available',
			truncated
		};
	}
}

export function validateExplorerLocalAccountChangesQuery(
	query: ExplorerLocalAccountChangesQuery
): void {
	if (!StrKey.isValidEd25519PublicKey(query.accountId)) {
		throw new TypeError('accountId must be a valid G-address');
	}
	if (
		!Number.isInteger(query.limit) ||
		query.limit < 1 ||
		query.limit > explorerLocalAccountChangeLimitMaximum
	) {
		throw new TypeError(
			`limit must be between 1 and ${explorerLocalAccountChangeLimitMaximum}`
		);
	}
}

export const explorerLocalAccountChangesSql = `
	with complete_coverage as not materialized (
		select coverage."batch_id" as "batchId",
			batch."start_ledger"::text as "firstLedger",
			batch."end_ledger"::text as "lastLedger",
			batch."ledger_count" as "ledgerCount",
			batch."processing_manifest_sha256" as "manifestSha256Buffer",
			batch."processed_at" as "batchProcessedAt",
			dataset."dataset" as "datasetName",
			dataset."schema_version" as "datasetSchemaVersion",
			dataset."record_count"::text as "datasetRecordCount",
			dataset."output_sha256" as "datasetOutputSha256Buffer",
			state_import."imported_row_set_sha256" as "importedRowSetSha256Buffer",
			state_import."completed_at" as "datasetImportedAt",
			coverage."minimum_proof_version" as "minimumProofVersion",
			coverage."latest_proof_evaluated_at" as "proofEvaluatedAt",
			coverage."completed_at" as "coverageCompletedAt",
			array(
				select proof_link."canonical_batch_id"::text
				from "full_history_lcm_state_canonical_batch_link" proof_link
				where proof_link."lcm_batch_id" = coverage."batch_id"
				order by proof_link."canonical_batch_id"
			) as "canonicalBatchIds"
		from "full_history_lcm_state_canonical_coverage" coverage
		join "full_history_ledger_close_meta_batch" batch
			on batch."id" = coverage."batch_id"
			and batch."network_passphrase_hash" = coverage."network_passphrase_hash"
		join "full_history_ledger_close_meta_dataset" dataset
			on dataset."batch_id" = coverage."batch_id"
			and dataset."network_passphrase_hash" = coverage."network_passphrase_hash"
			and dataset."dataset" = 'account-state-changes'
		join "full_history_lcm_state_import" state_import
			on state_import."batch_id" = coverage."batch_id"
			and state_import."dataset" = dataset."dataset"
			and state_import."status" = 'complete'
		where coverage."network_passphrase_hash" = $1
			and coverage."status" = 'complete'
	), latest_coverage as (
		select proof_gate.*, ledger."closed_at" as "latestLedgerClosedAt"
		from complete_coverage proof_gate
		join "full_history_lcm_ledger_projection" ledger
			on ledger."batch_id" = proof_gate."batchId"
			and ledger."ledger_sequence" = proof_gate."lastLedger"::bigint
		order by proof_gate."lastLedger"::bigint desc, proof_gate."batchId" desc
		limit 1
	)
	select observation."batchId" is not null as "hasObservation",
		observation."accountId", observation."balance",
		observation."buyingLiabilities", observation."sellingLiabilities",
		observation."sequenceNumber", observation."sequenceLedger",
		observation."sequenceTime", observation."subentryCount",
		observation."flags", observation."homeDomain",
		observation."inflationDestination", observation."masterWeight",
		observation."lowThreshold", observation."mediumThreshold",
		observation."highThreshold", observation."sponsoredEntryCount",
		observation."sponsoringEntryCount", observation."signerCount",
		observation."signerKeys", observation."signerWeights",
		observation."signerSponsors", observation."ledgerSequence",
		observation."transactionIndex", observation."changeIndex",
		observation."operationIndex", observation."upgradeIndex",
		observation."transactionHash", observation."reason",
		observation."changeType", observation."changeTypeString",
		observation."deleted", observation."lastModifiedLedger",
		observation."sponsor", observation."closedAtUnixMillis",
		observation."observationLedgerClosedAt",
		observation."ledgerKeySha256", observation."rowSha256",
		observation."coverageFirstLedger", observation."coverageLastLedger",
		observation."coverageLedgerCount", observation."batchId",
		observation."batchProcessedAt", observation."datasetName",
		observation."datasetSchemaVersion", observation."datasetRecordCount",
		observation."datasetOutputSha256", observation."datasetImportedRowSetSha256",
		observation."datasetImportedAt", observation."manifestSha256",
		observation."minimumProofVersion", observation."canonicalBatchIds",
		observation."canonicalProofEvaluatedAt",
		observation."canonicalCoverageCompletedAt",
		latest."batchId" as "latestBatchId",
		latest."firstLedger" as "latestFirstLedger",
		latest."lastLedger" as "latestLastLedger",
		latest."ledgerCount" as "latestLedgerCount",
		latest."latestLedgerClosedAt",
		latest."proofEvaluatedAt" as "latestProofEvaluatedAt",
		latest."coverageCompletedAt" as "latestCoverageCompletedAt"
	from latest_coverage latest
	left join lateral (
		select account_change."account_id" as "accountId",
			account_change."balance"::text as "balance",
			account_change."buying_liabilities"::text as "buyingLiabilities",
			account_change."selling_liabilities"::text as "sellingLiabilities",
			account_change."sequence_number"::text as "sequenceNumber",
			account_change."sequence_ledger"::text as "sequenceLedger",
			account_change."sequence_time"::text as "sequenceTime",
			account_change."subentry_count"::text as "subentryCount",
			account_change."flags"::text as "flags",
			account_change."home_domain" as "homeDomain",
			account_change."inflation_destination" as "inflationDestination",
			account_change."master_weight" as "masterWeight",
			account_change."low_threshold" as "lowThreshold",
			account_change."medium_threshold" as "mediumThreshold",
			account_change."high_threshold" as "highThreshold",
			account_change."sponsored_entry_count"::text as "sponsoredEntryCount",
			account_change."sponsoring_entry_count"::text as "sponsoringEntryCount",
			account_change."signer_count"::text as "signerCount",
			account_change."signer_keys" as "signerKeys",
			account_change."signer_weights" as "signerWeights",
			account_change."signer_sponsors" as "signerSponsors",
			account_change."ledger_sequence"::text as "ledgerSequence",
			account_change."transaction_index"::text as "transactionIndex",
			account_change."change_index"::text as "changeIndex",
			account_change."operation_index"::text as "operationIndex",
			account_change."upgrade_index"::text as "upgradeIndex",
			encode(account_change."transaction_hash", 'hex') as "transactionHash",
			account_change."reason", account_change."change_type" as "changeType",
			account_change."change_type_string" as "changeTypeString",
			account_change."deleted",
			account_change."last_modified_ledger"::text as "lastModifiedLedger",
			account_change."sponsor",
			account_change."closed_at_unix_millis"::text as "closedAtUnixMillis",
			observation_ledger."closed_at" as "observationLedgerClosedAt",
			encode(account_change."ledger_key_sha256", 'hex') as "ledgerKeySha256",
			encode(account_change."row_sha256", 'hex') as "rowSha256",
			proof_gate."firstLedger" as "coverageFirstLedger",
			proof_gate."lastLedger" as "coverageLastLedger",
			proof_gate."ledgerCount" as "coverageLedgerCount",
			proof_gate."batchId", proof_gate."batchProcessedAt",
			proof_gate."datasetName", proof_gate."datasetSchemaVersion",
			proof_gate."datasetRecordCount",
			encode(proof_gate."datasetOutputSha256Buffer", 'hex') as "datasetOutputSha256",
			encode(proof_gate."importedRowSetSha256Buffer", 'hex') as "datasetImportedRowSetSha256",
			proof_gate."datasetImportedAt",
			encode(proof_gate."manifestSha256Buffer", 'hex') as "manifestSha256",
			proof_gate."minimumProofVersion", proof_gate."canonicalBatchIds",
			proof_gate."proofEvaluatedAt" as "canonicalProofEvaluatedAt",
			proof_gate."coverageCompletedAt" as "canonicalCoverageCompletedAt"
		from "full_history_lcm_account_state_change" account_change
		join complete_coverage proof_gate
			on proof_gate."batchId" = account_change."batch_id"
		join "full_history_lcm_ledger_projection" observation_ledger
			on observation_ledger."batch_id" = account_change."batch_id"
			and observation_ledger."ledger_sequence" = account_change."ledger_sequence"
		where account_change."account_id" = $2
		order by account_change."ledger_sequence" desc,
			account_change."transaction_index" desc,
			account_change."change_index" desc,
			account_change."batch_id"
		limit $3
	) observation on true
	order by observation."ledgerSequence"::bigint desc nulls last,
		observation."transactionIndex"::bigint desc nulls last,
		observation."changeIndex"::bigint desc nulls last,
		observation."batchId"
`;
