package clickhouse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAutoStorageLayoutOldNewMixedAndStrictAssertions(t *testing.T) {
	for _, check := range []struct {
		name, engine, comment, detailsKind, detailsExpression string
		explicitVirtual, explicitSingle                       bool
		wantVirtual, wantSingle, valid, detectionFailure      bool
	}{
		{name: "old", engine: "ReplacingMergeTree", valid: true},
		{name: "new", engine: "View", comment: "stellaratlas-ledger-transactions-v1", detailsKind: "ALIAS", detailsExpression: "details_json", wantVirtual: true, wantSingle: true, valid: true},
		{name: "ledger migrated only", engine: "View", comment: "stellaratlas-ledger-transactions-v1", wantVirtual: true, valid: true},
		{name: "operations migrated only", engine: "ReplacingMergeTree", detailsKind: "ALIAS", detailsExpression: "`details_json`", wantSingle: true, valid: true},
		{name: "unknown view", engine: "View", comment: "not-the-reviewed-view", detectionFailure: true},
		{name: "missing ledger object", detectionFailure: true},
		{name: "unknown operations alias", engine: "ReplacingMergeTree", detailsKind: "ALIAS", detailsExpression: "other", detectionFailure: true},
		{name: "explicit virtual still strict", engine: "ReplacingMergeTree", explicitVirtual: true, wantVirtual: true},
		{name: "explicit single-copy still strict", engine: "ReplacingMergeTree", explicitSingle: true, wantSingle: true},
	} {
		t.Run(check.name, func(t *testing.T) {
			var queries []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				query := r.URL.Query().Get("query")
				queries = append(queries, query)
				switch {
				case strings.Contains(query, "system.data_skipping_indices"):
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
				case strings.Contains(query, "system.tables"):
					data := []map[string]string{}
					if check.engine != "" {
						data = append(data, map[string]string{"engine": check.engine, "comment": check.comment})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
				case strings.Contains(query, "system.columns"):
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{
						{"name": "details", "type": "Dynamic", "default_kind": check.detailsKind, "default_expression": check.detailsExpression},
						{"name": "details_json", "type": "Dynamic", "default_kind": "", "default_expression": ""},
					}})
				}
			}))
			defer server.Close()
			client, err := New(Config{
				Endpoint: server.URL, Database: "test", AutoStorageLayout: true,
				VirtualLedgerTransactions: check.explicitVirtual,
				SingleCopyOperations:      check.explicitSingle,
			})
			if err != nil {
				t.Fatal(err)
			}
			err = client.Initialize(context.Background())
			if (err == nil) != check.valid {
				t.Fatalf("valid=%v error=%v", check.valid, err)
			}
			if client.virtualLedgerTransactions != check.wantVirtual || client.singleCopyOperations != check.wantSingle {
				t.Fatalf("discovered modes virtual=%v single=%v", client.virtualLedgerTransactions, client.singleCopyOperations)
			}
			if len(queries) < 2 || !strings.HasPrefix(queries[0], "CREATE DATABASE IF NOT EXISTS ") || !strings.Contains(queries[1], "system.tables") {
				t.Fatalf("detection must follow database creation immediately: %v", queries)
			}
			if check.detectionFailure {
				for _, query := range queries[1:] {
					if !strings.HasPrefix(query, "SELECT ") || !strings.Contains(query, "system.") {
						t.Fatalf("failed detection attempted non-metadata work: %s", query)
					}
				}
			} else if len(queries) < 3 || !strings.Contains(queries[2], "system.columns") {
				t.Fatal("operations detection must precede dataset DDL")
			}
			if !check.valid && !check.detectionFailure && !strings.Contains(err.Error(), "migration required") {
				t.Fatalf("explicit flag lost strict schema assertion: %v", err)
			}
			if check.valid {
				if err := client.CheckReady(context.Background()); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestAutoStorageLayoutDisabledDoesNotInspectMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Query().Get("query"), "system.") {
			t.Error("default initialization unexpectedly inspected layout metadata")
		}
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Initialize(context.Background()); err != nil {
		t.Fatal(err)
	}
	if client.singleCopyOperations || client.virtualLedgerTransactions {
		t.Fatal("default layout changed")
	}
}
