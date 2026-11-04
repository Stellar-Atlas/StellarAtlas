package clickhouse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func TestVirtualLedgerMarkersCountWithoutPhysicalWrites(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		t.Error("virtual markers must not issue HTTP requests")
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "test", VirtualLedgerTransactions: true})
	if err != nil {
		t.Fatal(err)
	}
	identity := BatchIdentity{ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", SourceSHA256: strings.Repeat("a", 64), StartLedger: 12, EndLedger: 12}
	writer, err := NewBatchWriter(client, identity, WriterLimits{MaximumRows: 1, MaximumBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if !writer.VirtualLedgerTransactions() {
		t.Fatal("optional projector capability not exposed")
	}
	for i := 0; i < 2; i++ {
		if err := writer.Emit(context.Background(), "ledger_transactions", 12, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	buffer := writer.tables["ledger_transactions"]
	if writer.TotalRows() != 2 || writer.ExpectedRows()["ledger_transactions"] != 2 || buffer.body.Len() != 0 || buffer.bufferRows != 0 || buffer.chunk != 0 {
		t.Fatal("logical markers changed counts or physical buffers")
	}
	if err := client.Insert(context.Background(), "ledger_transactions", "direct:0", []byte("{}")); err == nil || !strings.Contains(err.Error(), "cannot accept physical INSERTs") {
		t.Fatalf("direct insert not rejected: %v", err)
	}
	if requests != 0 {
		t.Fatal("virtual path wrote to the warehouse")
	}
	legacy, err := NewBatchWriter(&Client{}, identity, WriterLimits{MaximumRows: 1, MaximumBytes: 1024})
	if err != nil || legacy.VirtualLedgerTransactions() {
		t.Fatal("default capability changed")
	}
}

func TestVirtualLedgerMetadataAndRecoveryUsePhysicalSource(t *testing.T) {
	t.Run("view contract and initialization", func(t *testing.T) {
		for _, check := range []struct {
			engine, comment string
			valid           bool
		}{
			{"View", "stellaratlas-ledger-transactions-v1", true},
			{"ReplacingMergeTree", "stellaratlas-ledger-transactions-v1", false},
			{"View", "wrong-version", false},
			{"", "", false},
		} {
			var queries []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				query := r.URL.Query().Get("query")
				queries = append(queries, query)
				if strings.Contains(query, "system.tables") {
					data := []map[string]string{}
					if check.engine != "" {
						data = append(data, map[string]string{"engine": check.engine, "comment": check.comment})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
				}
			}))
			client, err := New(Config{Endpoint: server.URL, Database: "test", VirtualLedgerTransactions: true})
			if err != nil {
				t.Fatal(err)
			}
			for _, probe := range []func(context.Context) error{client.CheckReady, client.Initialize} {
				err := probe(context.Background())
				if (err == nil) != check.valid || err != nil && !strings.Contains(err.Error(), "migration required") {
					t.Fatalf("engine=%q comment=%q valid=%v error=%v", check.engine, check.comment, check.valid, err)
				}
			}
			for _, query := range queries {
				if strings.Contains(query, "`ledger_transactions`") && (strings.HasPrefix(query, "CREATE ") || strings.HasPrefix(query, "ALTER ")) {
					t.Fatalf("virtual initialization attempted DDL: %s", query)
				}
			}
			server.Close()
		}
	})
	t.Run("recovery identity without view or dictionary reads", func(t *testing.T) {
		var queries []string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			query := r.URL.Query().Get("query")
			queries = append(queries, query)
			stats := batchRowStats{}
			if strings.Contains(query, ".`history_transactions` PREWHERE") {
				stats.Rows, stats.Distinct, stats.Maximum = 2, 2, 1
			}
			_ = json.NewEncoder(w).Encode(stats)
		}))
		defer server.Close()
		client, err := New(Config{Endpoint: server.URL, Database: "test", VirtualLedgerTransactions: true})
		if err != nil {
			t.Fatal(err)
		}
		identity := BatchIdentity{ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", SourceSHA256: strings.Repeat("a", 64), StartLedger: 12, EndLedger: 12}
		expected := make(map[string]uint64)
		for _, dataset := range schema.Datasets() {
			expected[dataset.Name] = 0
		}
		expected["history_transactions"], expected["ledger_transactions"] = 2, 2
		if err := client.VerifyBatchRows(context.Background(), identity, expected); err != nil {
			t.Fatal(err)
		}
		sourceReads := 0
		for _, query := range queries {
			if strings.Contains(query, "ledger_transactions") || strings.Contains(query, "dictGet") {
				t.Fatal("recovery evaluated the reconstructed view")
			}
			if strings.Contains(query, ".`history_transactions` PREWHERE") {
				sourceReads++
				if !strings.Contains(query, "`ledger_sequence` BETWEEN") || !strings.Contains(query, "_source_sha256 != {digest:String}") || !strings.Contains(query, "_batch_id={batch:UUID}") {
					t.Fatal("virtual recovery lost immutable source identity bounds")
				}
			}
		}
		if sourceReads != 2 {
			t.Fatalf("expected source verification for both logical datasets, got %d", sourceReads)
		}
		expected["ledger_transactions"] = 3
		if err := client.VerifyBatchRows(context.Background(), identity, expected); err == nil || !strings.Contains(err.Error(), "ledger_transactions") {
			t.Fatal("virtual logical-count mismatch was not rejected")
		}
	})
}
