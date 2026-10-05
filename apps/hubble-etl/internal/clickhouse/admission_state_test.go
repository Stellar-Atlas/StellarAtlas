package clickhouse

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBatchAdmissionSnapshotResolvesPublishedAndIncomplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		if query != "SELECT batch_id, source_sha256, status FROM `test`._ingestion_batches FINAL FORMAT JSONEachRow" {
			t.Errorf("unexpected query %s", query)
		}
		for i, state := range []string{"complete", "failed", "started"} {
			fmt.Fprintf(w, "{\"batch_id\":\"00000000-0000-4000-8000-00000000000%d\",\"source_sha256\":\"%s\",\"status\":\"%s\"}\n", i, strings.Repeat("a", 64), state)
		}
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "test"})
	if err != nil {
		t.Fatal(err)
	}
	state, err := client.BatchAdmissionState(context.Background())
	if err != nil || len(state.Completed) != 1 || len(state.Incomplete) != 2 {
		t.Fatalf("state=%v err=%v", state, err)
	}
	if _, ok := state.Completed["00000000-0000-4000-8000-000000000001"]; ok {
		t.Fatal("failed batch published")
	}
}

func TestBatchAdmissionSnapshotFailsClosed(t *testing.T) {
	for _, row := range []string{
		`{"batch_id":"invalid","source_sha256":"invalid","status":"complete"}`,
		`{"batch_id":"00000000-0000-4000-8000-000000000000","source_sha256":"` + strings.Repeat("a", 64) + `","status":"unknown"}`,
		`{broken`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, row) }))
		client, err := New(Config{Endpoint: server.URL, Database: "test"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := client.BatchAdmissionState(context.Background()); err == nil {
			t.Fatal("invalid state accepted", row)
		}
		server.Close()
	}
}

func TestCompletedBatchesRetainsLegacyResponseContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("query") != "SELECT batch_id, source_sha256 FROM `test`._ingestion_batches FINAL WHERE status='complete' FORMAT JSONEachRow" {
			t.Fatal("legacy query changed")
		}
		fmt.Fprintf(w, "{\"batch_id\":\"00000000-0000-4000-8000-000000000000\",\"source_sha256\":\"%s\"}\n", strings.Repeat("a", 64))
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "test"})
	if err != nil {
		t.Fatal(err)
	}
	completed, err := client.CompletedBatches(context.Background())
	if err != nil || len(completed) != 1 {
		t.Fatalf("completed=%v err=%v", completed, err)
	}
}
