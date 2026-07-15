export const legacyFullHistoryLedgerCloseMetaDatasetContractPredicateSql =
	composeFullHistoryLedgerCloseMetaDatasetContractPredicateSql(false);

export const fullHistoryLedgerCloseMetaDatasetContractPredicateSql =
	composeFullHistoryLedgerCloseMetaDatasetContractPredicateSql(true);

export const createFullHistoryLedgerCloseMetaDatasetContractSql = `
	alter table "full_history_ledger_close_meta_dataset"
		add constraint "chk_full_history_lcm_dataset_contract" check (
			${fullHistoryLedgerCloseMetaDatasetContractPredicateSql}
		);

	create function assert_full_history_lcm_batch_dataset_set(target uuid)
	returns void language plpgsql as $$
	declare
		batch_ledgers integer;
		dataset_count bigint;
		canonical_records bigint;
		ledger_records bigint;
		transaction_records bigint;
		result_records bigint;
		meta_records bigint;
	begin
		select "ledger_count" into strict batch_ledgers
		from "full_history_ledger_close_meta_batch" where "id" = target;
		select count(*),
			max("record_count") filter (where "dataset" = 'ledger-close-meta'),
			max("record_count") filter (where "dataset" = 'ledgers'),
			max("record_count") filter (where "dataset" = 'transactions'),
			max("record_count") filter (where "dataset" = 'transaction-results'),
			max("record_count") filter (where "dataset" = 'transaction-meta')
		into dataset_count, canonical_records, ledger_records,
			transaction_records, result_records, meta_records
		from "full_history_ledger_close_meta_dataset"
		where "batch_id" = target;
		if dataset_count <> 8
			or canonical_records <> batch_ledgers
			or ledger_records <> batch_ledgers
			or transaction_records is null
			or result_records <> transaction_records
			or meta_records <> transaction_records then
			raise exception 'full-history LedgerCloseMeta batch must have its exact durable output set';
		end if;
	end
	$$;

	create function validate_full_history_lcm_batch_dataset_set()
	returns trigger language plpgsql as $$
	begin
		perform assert_full_history_lcm_batch_dataset_set(new."id");
		return new;
	end
	$$;

	create function validate_full_history_lcm_dataset_set()
	returns trigger language plpgsql as $$
	begin
		perform assert_full_history_lcm_batch_dataset_set(new."batch_id");
		return new;
	end
	$$;

	create constraint trigger "trg_validate_full_history_lcm_batch_datasets"
	after insert on "full_history_ledger_close_meta_batch"
	deferrable initially deferred
	for each row execute function validate_full_history_lcm_batch_dataset_set();

	create constraint trigger "trg_validate_full_history_lcm_dataset_set"
	after insert on "full_history_ledger_close_meta_dataset"
	deferrable initially deferred
	for each row execute function validate_full_history_lcm_dataset_set();
`;

export const dropFullHistoryLedgerCloseMetaDatasetContractSql = `
	drop function validate_full_history_lcm_dataset_set();
	drop function validate_full_history_lcm_batch_dataset_set();
	drop function assert_full_history_lcm_batch_dataset_set(uuid);
`;

function composeFullHistoryLedgerCloseMetaDatasetContractPredicateSql(
	acceptCompleteProjectionSchemas: boolean
): string {
	const contractEventVersions = acceptCompleteProjectionSchemas
		? "('stellar-atlas.full-history.contract-events.v2', 'stellar-atlas.full-history.contract-events.v3')"
		: "('stellar-atlas.full-history.contract-events.v2')";
	const ledgerEntryChangeVersions = acceptCompleteProjectionSchemas
		? "('stellar-atlas.full-history.ledger-entry-changes.v2', 'stellar-atlas.full-history.ledger-entry-changes.v3')"
		: "('stellar-atlas.full-history.ledger-entry-changes.v2')";
	return `
		("dataset" = 'ledger-close-meta'
			and "media_type" = 'application/x-stellar-ledger-close-meta-batch+xdr+zstd'
			and "representation" = 'lossless-replay'
			and "schema_version" = 'stellar-atlas.full-history.ledger-close-meta-batch.v1')
		or ("media_type" = 'application/vnd.apache.parquet'
			and "representation" = 'typed-projection'
			and (
				("dataset" = 'ledgers'
					and "schema_version" = 'stellar-atlas.full-history.ledgers.v2')
				or ("dataset" = 'transactions'
					and "schema_version" = 'stellar-atlas.full-history.transactions.v2')
				or ("dataset" = 'operations'
					and "schema_version" = 'stellar-atlas.full-history.operations.v2')
				or ("dataset" = 'transaction-results'
					and "schema_version" = 'stellar-atlas.full-history.transaction-results.v2')
				or ("dataset" = 'transaction-meta'
					and "schema_version" = 'stellar-atlas.full-history.transaction-meta.v2')
				or ("dataset" = 'contract-events'
					and "schema_version" in ${contractEventVersions})
				or ("dataset" = 'ledger-entry-changes'
					and "schema_version" in ${ledgerEntryChangeVersions})
			)
		)`;
}
