package clickhouse

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
)

func TestPendingInsertExactByteThresholdChunks(t *testing.T) {
	var mu sync.Mutex
	var calls []capturedInsert
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		calls = append(calls, capturedInsert{r.URL.Query().Get("query"), r.URL.Query().Get("param_token"), body})
		mu.Unlock()
	}))
	defer server.Close()
	var baseline []capturedInsert
	for _, pending := range []int{0, 2} {
		w := pipelineWriter(t, server, pending, 0)
		w.limits.MaximumRows, w.limits.MaximumBytes = 100, 1024
		for row := range 15 {
			if err := pipelineEmit(w, context.Background(), row); err != nil {
				t.Fatal(err)
			}
		}
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
		mu.Lock()
		result := calls
		calls = nil
		mu.Unlock()
		sort.Slice(result, func(a, b int) bool { return result[a].token < result[b].token })
		if len(result) < 2 || w.flushedRows != 15 || w.flushedChunks != uint64(len(result)) {
			t.Fatal("byte threshold or counts changed")
		}
		if pending == 0 {
			baseline = result
		} else if !reflect.DeepEqual(result, baseline) {
			t.Fatal("byte-threshold request identity/body changed")
		}
	}
}

func TestPendingInsertVirtualRowsStayLogicalOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("virtual row issued HTTP") }))
	defer server.Close()
	w := pipelineWriter(t, server, 2, 0)
	w.client.virtualLedgerTransactions = true
	for range 3 {
		if err := w.Emit(context.Background(), "ledger_transactions", 1, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if w.TotalRows() != 3 || w.ExpectedRows()["ledger_transactions"] != 3 || w.flushedRows != 0 || len(w.pendingInserts) != 0 {
		t.Fatal("virtual row accounting changed")
	}
}

func TestPendingInsertHolderStagingAfterDatasetAcknowledgement(t *testing.T) {
	started, metadata, release := make(chan struct{}, 2), make(chan string, 10), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		query := r.URL.Query().Get("query")
		if strings.Contains(query, ".`history_ledgers`") {
			started <- struct{}{}
			<-release
		} else {
			metadata <- query
		}
	}))
	defer server.Close()
	w := pipelineWriter(t, server, 2, 0)
	w.client.holderIndexEnabled = true
	w.holderIndexRows = make(map[string]holderIndexUpdate)
	w.poolIndexRows = make(map[string]poolIndexUpdate)
	if err := pipelineEmit(w, context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	awaitPipeline(t, started)
	done := make(chan error, 1)
	go func() { done <- w.Flush(context.Background()) }()
	pipelineBlocked(t, done)
	select {
	case query := <-metadata:
		t.Fatalf("index metadata preceded acknowledgement: %s", query)
	default:
	}
	close(release)
	if err := awaitPipeline(t, done); err != nil {
		t.Fatal(err)
	}
	if query := awaitPipeline(t, metadata); !strings.Contains(query, "_asset_holder_index_batches") {
		t.Fatal(query)
	}
}
