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

func TestDatabaseNameIsValidated(t *testing.T) {
	t.Parallel()
	if _, err := DatabaseSQL("stellar_hubble"); err != nil {
		t.Fatal(err)
	}
	if _, err := DatabaseSQL("bad; drop table"); err == nil {
		t.Fatal("expected invalid database name to fail")
	}
}
