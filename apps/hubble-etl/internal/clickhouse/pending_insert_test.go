package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func pipelineWriter(t *testing.T, server *httptest.Server, pending, budget int) *BatchWriter {
	t.Helper()
	client, err := New(Config{Endpoint: server.URL, Database: "pipeline_test", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	w, err := NewBatchWriter(client, BatchIdentity{
		ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", SourceSHA256: strings.Repeat("a", 64),
		StartLedger: 1, EndLedger: 10,
	}, WriterLimits{MaximumRows: 1, MaximumBytes: 1 << 20,
		MaximumPendingInserts: pending, MaximumPendingInsertBytes: budget})
	if err != nil {
		t.Fatal(err)
	}
	w.ingestedAt = time.Unix(1, 0).UTC()
	return w
}

func pipelineEmit(w *BatchWriter, ctx context.Context, id int) error {
	return w.Emit(ctx, "history_ledgers", 1, map[string]any{"id": id})
}

func awaitPipeline[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(5 * time.Second):
		t.Fatal("pipeline did not make bounded progress")
	}
	var zero T
	return zero
}

func pipelineBlocked(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("returned before acknowledgement: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
}

func TestPendingInsertSerialAsyncExactRequests(t *testing.T) {
	for _, dynamic := range []bool{false, true} {
		t.Run(fmt.Sprint(dynamic), func(t *testing.T) {
			var mu sync.Mutex
			var calls []capturedInsert
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				mu.Lock()
				calls = append(calls, capturedInsert{r.URL.Query().Get("query"), r.URL.Query().Get("param_token"), body})
				mu.Unlock()
			}))
			defer server.Close()
			results := make([][]capturedInsert, 2)
			for index, pending := range []int{0, 2} {
				w := pipelineWriter(t, server, pending, 0)
				w.limits.MaximumRows = 2
				w.limits.RecoveryNamespace = "pipeline-test"
				for row := 0; row < 5; row++ {
					var err error
					if dynamic {
						// Existing Dynamic Map driver order is nondeterministic even
						// in serial mode. Scalars/arrays provide an exact-byte gate.
						err = w.Emit(context.Background(), "history_contract_events", 1, json.RawMessage(`{"data_decoded":[true,1,"1",null,[],["0123",false]],"contract_event_xdr":"AAAA"}`))
					} else {
						err = pipelineEmit(w, context.Background(), row)
					}
					if err != nil {
						t.Fatal(err)
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				if w.DatasetWriteStats().Rows != 5 || w.DatasetWriteStats().Chunks != 3 {
					t.Fatal(w.DatasetWriteStats())
				}
				mu.Lock()
				results[index] = calls
				calls = nil
				mu.Unlock()
				sort.Slice(results[index], func(a, b int) bool { return results[index][a].token < results[index][b].token })
			}
			if len(results[0]) != 3 || !reflect.DeepEqual(results[0], results[1]) {
				t.Fatal("token, query, exact body, or chunk boundary changed")
			}
			for chunk, call := range results[1] {
				if !strings.Contains(call.token, fmt.Sprintf(":%d:recovery:pipeline-test", chunk)) {
					t.Fatal(call.token)
				}
				if dynamic {
					if !strings.HasSuffix(call.token, ":native-v1") || !strings.Contains(call.query, "FORMAT Native") {
						t.Fatal(call)
					}
					continue
				}
				rows := bytes.Split(bytes.TrimSpace(call.body), []byte{'\n'})
				for offset, row := range rows {
					var value map[string]any
					if err := json.Unmarshal(row, &value); err != nil {
						t.Fatal(err)
					}
					if value["_row_number"] != float64(chunk*2+offset) || value["id"] != float64(chunk*2+offset) {
						t.Fatal(value)
					}
				}
			}
		})
	}
}

func TestPendingInsertLimitsAndWaitOnly(t *testing.T) {
	for _, byteLimit := range []bool{false, true} {
		t.Run(fmt.Sprint(byteLimit), func(t *testing.T) {
			started, release := make(chan struct{}, 10), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				started <- struct{}{}
				<-release
			}))
			defer server.Close()
			w := pipelineWriter(t, server, 2, 0)
			if err := pipelineEmit(w, context.Background(), 0); err != nil {
				t.Fatal(err)
			}
			awaitPipeline(t, started)
			if w.flushedRows != 0 {
				t.Fatal("unacknowledged rows counted")
			}
			if byteLimit {
				w.limits.MaximumPendingInsertBytes = w.pendingInsertBytes
			} else {
				if err := pipelineEmit(w, context.Background(), 1); err != nil {
					t.Fatal(err)
				}
				awaitPipeline(t, started)
			}
			done := make(chan error, 1)
			go func() { done <- pipelineEmit(w, context.Background(), 2) }()
			pipelineBlocked(t, done)
			select {
			case <-started:
				t.Fatal("pending bound exceeded")
			default:
			}
			close(release)
			if err := awaitPipeline(t, done); err != nil {
				t.Fatal(err)
			}
			if err := w.WaitPending(context.Background()); err != nil {
				t.Fatal(err)
			}
			if len(w.pendingInserts) != 0 || w.pendingInsertBytes != 0 {
				t.Fatal("jobs retained")
			}
			w.limits.MaximumRows = 100
			if err := pipelineEmit(w, context.Background(), 3); err != nil {
				t.Fatal(err)
			}
			before := w.flushedRows
			if err := w.WaitPending(context.Background()); err != nil {
				t.Fatal(err)
			}
			if w.flushedRows != before || w.tables["history_ledgers"].bufferRows != 1 {
				t.Fatal("WaitPending flushed new rows")
			}
		})
	}
}

func TestPendingInsertOversizeDrainsAndRunsSynchronously(t *testing.T) {
	started, release := make(chan string, 10), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- r.URL.Query().Get("param_token")
		<-release
	}))
	defer server.Close()
	w := pipelineWriter(t, server, 2, 0)
	if err := pipelineEmit(w, context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	awaitPipeline(t, started)
	w.limits.MaximumPendingInsertBytes = 1
	done := make(chan error, 1)
	go func() { done <- pipelineEmit(w, context.Background(), 1) }()
	pipelineBlocked(t, done)
	select {
	case <-started:
		t.Fatal("oversize ran before pending drain")
	default:
	}
	close(release)
	if err := awaitPipeline(t, done); err != nil {
		t.Fatal(err)
	}
	if token := awaitPipeline(t, started); !strings.HasSuffix(token, ":1") {
		t.Fatal(token)
	}
	if len(w.pendingInserts) != 0 || w.flushedRows != 2 || w.flushedChunks != 2 {
		t.Fatal("oversize not synchronous")
	}
}

func TestPendingInsertGlobalFourPermits(t *testing.T) {
	started, release := make(chan struct{}, 10), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		<-release
	}))
	defer server.Close()
	var writers []*BatchWriter
	for range 3 {
		w := pipelineWriter(t, server, 2, 0)
		writers = append(writers, w)
		for row := range 2 {
			if err := pipelineEmit(w, context.Background(), row); err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 4 {
		awaitPipeline(t, started)
	}
	select {
	case <-started:
		t.Fatal("global permit cap exceeded")
	case <-time.After(30 * time.Millisecond):
	}
	if len(datasetInsertPermits) != 4 {
		t.Fatal("missing permits")
	}
	close(release)
	for _, w := range writers {
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		awaitPipeline(t, started)
	}
	if len(datasetInsertPermits) != 0 {
		t.Fatal("permits leaked")
	}
}
