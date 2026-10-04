package clickhouse

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRecoveryRowIdentityGate(t *testing.T) {
	for _, tc := range []struct {
		name  string
		stats batchRowStats
		want  uint64
		ok    bool
	}{
		{"empty", batchRowStats{}, 0, true},
		{"complete", batchRowStats{Rows: 3, Distinct: 3, Maximum: 2}, 3, true},
		{"dedup suppressed", batchRowStats{Rows: 2, Distinct: 2, Maximum: 1}, 3, false},
		{"duplicate", batchRowStats{Rows: 3, Distinct: 2, Maximum: 2}, 3, false},
		{"gap", batchRowStats{Rows: 3, Distinct: 3, Maximum: 3}, 3, false},
		{"shifted", batchRowStats{Rows: 3, Distinct: 3, Minimum: 1, Maximum: 3}, 3, false},
		{"wrong digest", batchRowStats{Rows: 3, Distinct: 3, Maximum: 2, WrongSource: 1}, 3, false},
		{"nonempty preflight", batchRowStats{Rows: 1, Distinct: 1}, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if (validateBatchRowStats(tc.stats, tc.want) == nil) != tc.ok {
				t.Fatal(tc)
			}
		})
	}
}

func TestRecoveryWriterStableAndSeparate(t *testing.T) {
	type call struct{ token, body string }
	var calls []call
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls = append(calls, call{r.URL.Query().Get("param_token"), string(body)})
		w.WriteHeader(200)
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "hubble_test"})
	if err != nil {
		t.Fatal(err)
	}
	id := BatchIdentity{ID: "29cf59e5-0665-4875-b37d-4b7b05bd85f2", SourceSHA256: strings.Repeat("a", 64), StartLedger: 1, EndLedger: 1}
	limits := WriterLimits{MaximumRows: 1, MaximumBytes: 1024, RecoveryNamespace: "incident-20261003-v1", RecoveryIngestedAt: time.Unix(1791068400, 0)}
	for i := 0; i < 2; i++ {
		w, err := NewBatchWriter(client, id, limits)
		if err != nil {
			t.Fatal(err)
		}
		if err = w.Emit(context.Background(), "history_transactions", 1, map[string]any{"id": 1}); err != nil {
			t.Fatal(err)
		}
		if w.ExpectedRows()["history_transactions"] != 1 {
			t.Fatal("missing expected row")
		}
	}
	if len(calls) != 2 || calls[0] != calls[1] || !strings.HasSuffix(calls[0].token, ":recovery:incident-20261003-v1") {
		t.Fatal(calls)
	}
	limits.RecoveryIngestedAt = time.Time{}
	if _, err = NewBatchWriter(client, id, limits); err == nil {
		t.Fatal("missing fixed timestamp allowed")
	}
}
