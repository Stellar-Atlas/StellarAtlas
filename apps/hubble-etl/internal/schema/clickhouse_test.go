package schema

import (
	"strings"
	"testing"
)

func TestAllOfficialDatasetsProduceTypedClickHouseDDL(t *testing.T) {
	t.Parallel()
	datasets := Datasets()
	if len(datasets) != 20 {
		t.Fatalf("got %d datasets, want 20", len(datasets))
	}
	seen := map[string]bool{}
	for _, dataset := range datasets {
		if seen[dataset.Name] {
			t.Fatalf("duplicate dataset %s", dataset.Name)
		}
		seen[dataset.Name] = true
		columns, err := Columns(dataset)
		if err != nil {
			t.Fatalf("%s columns: %v", dataset.Name, err)
		}
		if len(columns) <= 5 {
			t.Fatalf("%s has no official row columns", dataset.Name)
		}
		sql, err := TableSQL("stellar_hubble", dataset)
		if err != nil {
			t.Fatalf("%s DDL: %v", dataset.Name, err)
		}
		if !strings.Contains(sql, "ReplacingMergeTree") ||
			!strings.Contains(sql, "PARTITION BY intDiv(_ledger_sequence, 1048576)") {
			t.Fatalf("%s DDL does not have the expected storage layout", dataset.Name)
		}
	}
}

func TestPointLookupIndexesAreValidatedAndIdempotent(t *testing.T) {
	t.Parallel()
	for _, dataset := range Datasets() {
		statements, err := SkippingIndexSQL("stellar_hubble", dataset)
		if err != nil {
			t.Fatalf("%s indexes: %v", dataset.Name, err)
		}
		for _, statement := range statements {
			if !strings.Contains(statement, "ADD INDEX IF NOT EXISTS") {
				t.Fatalf("%s index is not idempotent: %s", dataset.Name, statement)
			}
		}
	}

	transactions, ok := Lookup("history_transactions")
	if !ok {
		t.Fatal("history_transactions dataset is missing")
	}
	statements, err := SkippingIndexSQL("stellar_hubble", transactions)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(statements, "\n")
	if !strings.Contains(joined, "`idx_transaction_hash` `transaction_hash` TYPE bloom_filter(0.01)") ||
		!strings.Contains(joined, "`idx_transaction_account` `account` TYPE bloom_filter(0.01)") {
		t.Fatalf("transaction point-lookup indexes are incomplete: %s", joined)
	}
}

func TestDatabaseNameIsValidated(t *testing.T) {
	t.Parallel()
	if _, err := DatabaseSQL("stellar_hubble"); err != nil {
		t.Fatal(err)
	}
	if _, err := DatabaseSQL("bad; drop table"); err == nil {
		t.Fatal("expected invalid database name to fail")
	}
}

func TestOnlyWideTransactionTablesHaveBoundedFutureMergeInputs(t *testing.T) {
	t.Parallel()
	const cap = "max_bytes_to_merge_at_max_space_in_pool = 34359738368"
	for _, dataset := range Datasets() {
		sql, err := TableSQL("stellar_hubble_v2", dataset)
		if err != nil {
			t.Fatal(err)
		}
		wideTransactionTable := dataset.Name == "history_transactions" || dataset.Name == "ledger_transactions"
		if got := strings.Contains(sql, cap); got != wideTransactionTable {
			t.Fatalf("%s unexpected future merge input cap: %s", dataset.Name, sql)
		}
		if !strings.Contains(sql, "ENGINE = ReplacingMergeTree(_ingested_at)") ||
			!strings.Contains(sql, "non_replicated_deduplication_window = 65536") ||
			!strings.Contains(sql, "`_batch_id`, `_row_number`)") {
			t.Fatalf("%s must preserve version, retry deduplication and row identity", dataset.Name)
		}
	}
}
