package clickhouse

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func TestCheckReadyResolvesEveryRequiredTableWithoutDataReads(t *testing.T) {
	var queries []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries = append(queries, r.URL.Query().Get("query"))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "stellar_hubble_v2"})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.CheckReady(context.Background()); err != nil {
		t.Fatal(err)
	}
	tables := []string{"_ingestion_batches"}
	for _, dataset := range schema.Datasets() {
		tables = append(tables, dataset.Name)
	}
	if len(queries) != len(tables) {
		t.Fatalf("got %d queries for %d required tables", len(queries), len(tables))
	}
	for i, table := range tables {
		want := "DESCRIBE TABLE `stellar_hubble_v2`.`" + table + "` FORMAT Null"
		if queries[i] != want {
			t.Fatalf("query %d = %q, want %q", i, queries[i], want)
		}
	}
}

func TestCheckReadyRejectsFailedTableBehindLiveServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Query().Get("query"), "`ledger_transactions`") {
			http.Error(w, "Code: 722. ASYNC_LOAD_FAILED: broken merged part", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client, _ := New(Config{Endpoint: server.URL, Database: "stellar_hubble_v2"})
	err := client.CheckReady(context.Background())
	if !IsWarehouseFailure(err) || !strings.Contains(err.Error(), "stellar_hubble_v2.ledger_transactions") || !strings.Contains(err.Error(), "ASYNC_LOAD_FAILED") {
		t.Fatalf("missing actionable table-load failure: %v", err)
	}
}

func TestCheckReadyDeadlineAndFailureIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	client, _ := New(Config{Endpoint: server.URL, Database: "stellar_hubble_v2"})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err := client.CheckReady(ctx)
	if !errors.Is(err, context.DeadlineExceeded) || !IsWarehouseFailure(err) {
		t.Fatalf("deadline identity lost: %v", err)
	}
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{"source digest mismatch", errors.New("immutable source digest mismatch"), false},
		{"nil", nil, false},
		{"wrapped warehouse failure", fmt.Errorf("flush: %w", &RequestError{Err: errors.New("connection reset")}), true},
		{"normal shutdown", &RequestError{Err: context.Canceled}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := IsWarehouseFailure(test.err); got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
	if err := client.Insert(context.Background(), "unknown_source_table", "token", nil); IsWarehouseFailure(err) {
		t.Fatalf("local validation was classified as warehouse failure: %v", err)
	}
}
