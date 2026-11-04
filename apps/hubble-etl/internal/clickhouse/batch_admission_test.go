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

func TestBatchAdmissionForBoundsIDsAndClassifiesManifestStatuses(t *testing.T) {
	const (
		completeID = "11111111-1111-4111-8111-111111111111"
		startedID  = "22222222-2222-4222-8222-222222222222"
		failedID   = "33333333-3333-4333-8333-333333333333"
		digest     = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	)
	requests := 0
	var query string
	var firstID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		query = r.URL.Query().Get("query")
		firstID = r.URL.Query().Get("param_b0")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(
			`{"batch_id":"` + completeID + `","source_sha256":"` + digest + `","status":"complete"}` + "\n" +
				`{"batch_id":"` + startedID + `","source_sha256":"` + digest + `","status":"started"}` + "\n" +
				`{"batch_id":"` + failedID + `","source_sha256":"` + digest + `","status":"failed"}` + "\n",
		))
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "stellar_hubble_v2", HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}

	state, err := client.BatchAdmissionFor(context.Background(), []string{completeID, startedID, failedID})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 || firstID != completeID {
		t.Fatalf("request count/first bound = %d/%q", requests, firstID)
	}
	if !strings.Contains(query, "batch_id IN ({b0:UUID}, {b1:UUID}, {b2:UUID})") {
		t.Fatalf("query is not ID-bound: %s", query)
	}
	if len(state.Completed) != 1 || state.Completed[completeID] != digest {
		t.Fatalf("unexpected completed statuses: %#v", state.Completed)
	}
	if len(state.Incomplete) != 2 || state.Incomplete[startedID] != digest || state.Incomplete[failedID] != digest {
		t.Fatalf("unexpected incomplete statuses: %#v", state.Incomplete)
	}

	if _, err := client.BatchAdmissionFor(context.Background(), []string{"not-a-uuid"}); err == nil {
		t.Fatal("invalid ID was accepted")
	}
	tooMany := make([]string, 129)
	for index := range tooMany {
		tooMany[index] = completeID
	}
	if _, err := client.BatchAdmissionFor(context.Background(), tooMany); err == nil {
		t.Fatal("more than 128 IDs were accepted")
	}
	if _, err := client.BatchAdmissionFor(context.Background(), nil); err != nil {
		t.Fatalf("empty request should return an empty snapshot: %v", err)
	}
	if requests != 1 {
		t.Fatalf("invalid, oversized, or empty request performed HTTP calls: %d", requests)
	}
}

func TestBatchStatusProjectionCountsAreTypedAndOptional(t *testing.T) {
	counts := make(map[string]uint64)
	for _, dataset := range schema.Datasets() {
		counts[dataset.Name] = 0
	}
	counts["history_transactions"], counts["ledger_transactions"] = 7, 7
	payload, err := json.Marshal(BatchStatus{ExpectedDatasetRows: counts, ProjectionContract: "hubble-full20-v1"})
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Counts   map[string]uint64 `json:"expected_dataset_rows"`
		Contract string            `json:"projection_contract"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil || len(decoded.Counts) != 20 ||
		decoded.Counts["ledger_transactions"] != 7 || decoded.Contract != "hubble-full20-v1" {
		t.Fatalf("projection counts must be a typed object including zeros and the virtual count: %s, %v", payload, err)
	}
	legacy, err := json.Marshal(BatchStatus{})
	if err != nil || strings.Contains(string(legacy), "expected_dataset_rows") || strings.Contains(string(legacy), "projection_contract") {
		t.Fatalf("legacy/started statuses must omit undeclared projection metadata: %s, %v", legacy, err)
	}
}
