package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/internal/transform"
)

const holderTestAccount = "G" + "A" + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const holderTestIssuer = "G" + "B" + "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
const holderTestDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const holderTestBatch = "3dca0dce-5e01-4620-a95b-e95ce4a58323"

func holderTestClient(t *testing.T, handler http.HandlerFunc, enabled bool) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := New(Config{
		Endpoint: server.URL, Database: "hubble_test", HolderIndexEnabled: enabled,
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestHolderIndexOptInSchemaAndBatchLatestDeletion(t *testing.T) {
	var statements []string
	var staged []holderIndexUpdate
	client := holderTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		statements = append(statements, query)
		if strings.Contains(query, "._asset_holder_stage (") {
			if strings.Contains(query, "FORMAT JSONEachRow") {
				if strings.Contains(query, "FROM input(") || strings.Contains(query, "SELECT ") {
					t.Errorf("stage insert must not use input/select: %s", query)
				}
				body, _ := io.ReadAll(r.Body)
				for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
					if strings.TrimSpace(line) == "" {
						continue
					}
					row, err := decodeHolderStageRow([]byte(line))
					if err != nil {
						t.Errorf("decode staged row: %v", err)
					}
					staged = append(staged, row)
				}
			}
		}
		w.WriteHeader(http.StatusOK)
	}, true)
	if err := client.InitializeHolderIndex(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(statements) != 7 {
		t.Fatalf("want holder and pool tables plus an index marker, got %d statements", len(statements))
	}
	for _, query := range statements[:6] {
		if !strings.Contains(query, "storage_policy = 'stellar_read_models'") {
			t.Fatalf("missing default storage policy: %s", query)
		}
	}
	if !strings.Contains(statements[0], "SimpleAggregateFunction(max, Tuple(UInt32, UInt64") ||
		!strings.Contains(statements[1], "TTL created_at + INTERVAL 2 DAY DELETE") ||
		!strings.Contains(statements[3], "_asset_holder_index_assets") ||
		!strings.Contains(statements[4], "_asset_pool_current") ||
		!strings.Contains(statements[5], "_asset_pool_stage") ||
		!strings.Contains(statements[5], "TTL created_at + INTERVAL 2 DAY DELETE") {
		t.Fatal("holder/pool index DDL missing aggregate tuple or stage TTL")
	}
	if !strings.Contains(statements[6], "'__started__'") || !strings.Contains(statements[6], "minOrNull(updated_at)") || !strings.Contains(statements[6], "FINAL") {
		t.Fatalf("holder index start marker does not preserve the existing epoch: %s", statements[6])
	}
	writer, err := NewBatchWriter(client, BatchIdentity{
		ID: holderTestBatch, SourceSHA256: holderTestDigest, StartLedger: 10, EndLedger: 12,
	}, WriterLimits{MaximumRows: 100, MaximumBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	trustline := func(balance int, deleted bool) json.RawMessage {
		encoded, _ := json.Marshal(map[string]any{
			"account_id": holderTestAccount, "asset_type": "credit_alphanum4",
			"asset_code": "USD", "asset_issuer": holderTestIssuer,
			"balance": balance, "trust_line_limit": 100, "flags": 1,
			"deleted": deleted, "last_modified_ledger": 9,
			"closed_at": "2026-10-13T00:00:00Z", "sponsor": nil,
		})
		return encoded
	}
	if err := writer.Emit(context.Background(), "trustlines", 10, trustline(12, false)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Emit(context.Background(), "accounts", 11, json.RawMessage(`{"account_id":"`+holderTestAccount+`","balance":42.5,"buying_liabilities":1,"selling_liabilities":2,"home_domain":"example.org","deleted":false,"last_modified_ledger":8,"closed_at":"2026-10-13T00:00:00Z"}`)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Emit(context.Background(), "trustlines", 12, trustline(0, true)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(staged) != 2 || writer.HolderIndexRows() != 2 {
		t.Fatalf("expected native and latest credit rows, staged=%#v", staged)
	}
	var native, credit *holderIndexUpdate
	for i := range staged {
		row := &staged[i]
		switch row.AssetKey {
		case "native":
			native = row
		case "USD:" + holderTestIssuer:
			credit = row
		}
	}
	if native == nil || native.Balance != 42.5 || native.TrustlineLimit != 0 || native.HomeDomain != "example.org" {
		t.Fatalf("incorrect native holder tuple: %#v", native)
	}
	if credit == nil || credit.LedgerSequence != 12 || !credit.Deleted || credit.Balance != 0 {
		t.Fatalf("latest deletion not retained as tombstone: %#v", credit)
	}
}

func decodeHolderStageRow(encoded []byte) (holderIndexUpdate, error) {
	var wire struct {
		AssetKey     string            `json:"asset_key"`
		AccountID    string            `json:"account_id"`
		State        []json.RawMessage `json:"state"`
		BatchID      string            `json:"batch_id"`
		SourceSHA256 string            `json:"source_sha256"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		return holderIndexUpdate{}, err
	}
	if len(wire.State) != 15 {
		return holderIndexUpdate{}, fmt.Errorf("state tuple has %d fields; want 15", len(wire.State))
	}
	row := holderIndexUpdate{
		AssetKey: wire.AssetKey, AccountID: wire.AccountID,
		BatchID: wire.BatchID, SourceSHA256: wire.SourceSHA256,
	}
	fields := []any{
		&row.LedgerSequence, &row.RowNumber, &row.IngestedAt, &row.Balance,
		&row.BuyingLiabilities, &row.SellingLiabilities, &row.TrustlineLimit,
		&row.Flags, &row.Deleted, &row.LastModifiedLedger, &row.HomeDomain,
		&row.BatchID, &row.SourceSHA256, &row.Sponsor, &row.ClosedAt,
	}
	for i := range fields {
		if err := json.Unmarshal(wire.State[i], fields[i]); err != nil {
			return holderIndexUpdate{}, fmt.Errorf("decode state tuple field %d: %w", i+1, err)
		}
	}
	return row, nil
}

func TestPartialHolderStageIsNotMarkedStaged(t *testing.T) {
	var stageWrites, stagedMarkers int
	client := holderTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		switch {
		case strings.Contains(query, "._asset_holder_stage (") && strings.Contains(query, "FORMAT JSONEachRow"):
			stageWrites++
		case strings.Contains(query, "_asset_holder_index_batches"):
			stagedMarkers++
		}
		w.WriteHeader(http.StatusOK)
	}, true)
	writer, err := NewBatchWriter(client, BatchIdentity{
		ID: holderTestBatch, SourceSHA256: holderTestDigest, StartLedger: 10, EndLedger: 10,
	}, WriterLimits{MaximumRows: 1, MaximumBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	valid := json.RawMessage(`{"account_id":"` + holderTestAccount + `","asset_type":"credit_alphanum4","asset_code":"USD","asset_issuer":"` + holderTestIssuer + `","balance":7.25,"trust_line_limit":100,"deleted":false,"closed_at":"2026-10-13T00:00:00Z"}`)
	if err := writer.Emit(context.Background(), "trustlines", 10, valid); err != nil {
		t.Fatal(err)
	}
	invalid := json.RawMessage(`{"account_id":"` + holderTestAccount + `","asset_type":"credit_alphanum4","asset_code":"EUR","asset_issuer":"` + holderTestIssuer + `","balance":1}`)
	if err := writer.Emit(context.Background(), "trustlines", 10, invalid); err != nil {
		t.Fatalf("optional holder-index decode failure failed source emit: %v", err)
	}
	if err := writer.Flush(context.Background()); err != nil {
		t.Fatalf("optional holder-index failure failed source flush: %v", err)
	}
	if stageWrites != 1 || stagedMarkers != 0 || writer.HolderIndexFailure() == nil {
		t.Fatalf("partial holder stage must remain unpublished: writes=%d markers=%d failure=%v", stageWrites, stagedMarkers, writer.HolderIndexFailure())
	}
}

func TestHolderIndexFailureDoesNotPreventSourcePublication(t *testing.T) {
	var sourceComplete, targetPromoted bool
	client := holderTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		switch {
		case strings.Contains(query, "._asset_holder_stage ("):
			http.Error(w, "index disk unavailable", http.StatusServiceUnavailable)
		case strings.Contains(query, "INSERT INTO `hubble_test`._ingestion_batches"):
			body, _ := io.ReadAll(r.Body)
			sourceComplete = strings.Contains(string(body), `"status":"complete"`)
		case strings.Contains(query, "_asset_holder_current"):
			targetPromoted = true
		}
		w.WriteHeader(http.StatusOK)
	}, true)
	writer, err := NewBatchWriter(client, BatchIdentity{
		ID: holderTestBatch, SourceSHA256: holderTestDigest, StartLedger: 10, EndLedger: 10,
	}, WriterLimits{MaximumRows: 100, MaximumBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	row := json.RawMessage(`{"account_id":"` + holderTestAccount + `","asset_type":"credit_alphanum4","asset_code":"USD","asset_issuer":"` + holderTestIssuer + `","balance":7.25,"trust_line_limit":100,"deleted":false,"closed_at":"2026-10-13T00:00:00Z"}`)
	if err := writer.Emit(context.Background(), "trustlines", 10, row); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(context.Background()); err != nil {
		t.Fatalf("index-stage failure incorrectly failed source flush: %v", err)
	}
	if writer.HolderIndexFailure() == nil {
		t.Fatal("expected optional holder-index stage error")
	}
	if err := client.RecordBatch(context.Background(), BatchStatus{
		BatchID: holderTestBatch, SourceSHA256: holderTestDigest,
		StartLedger: 10, EndLedger: 10, Status: "complete",
		UpdatedAt: "2026-10-13T00:00:00Z",
	}); err != nil {
		t.Fatalf("source completion failed after index failure: %v", err)
	}
	if err := writer.PromoteHolderIndex(context.Background()); err == nil {
		t.Fatal("expected holder index promotion to remain unavailable")
	}
	if !sourceComplete || targetPromoted {
		t.Fatalf("publication boundary violated: sourceComplete=%v targetPromoted=%v", sourceComplete, targetPromoted)
	}
}

func TestHolderIndexDisabledDoesNotTouchTables(t *testing.T) {
	calls := 0
	client := holderTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}, false)
	if err := client.InitializeHolderIndex(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("disabled holder index made %d ClickHouse calls", calls)
	}
}

func TestHolderSourceDecodesOfficialTrustlineTransform(t *testing.T) {
	closedAt := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	transformed := transform.TrustlineOutput{
		AccountID: holderTestAccount, AssetType: "credit_alphanum4",
		AssetCode: "USD", AssetIssuer: holderTestIssuer, Balance: 12.5,
		TrustlineLimit: 9_000_000_000_000_000_000, BuyingLiabilities: 1.25,
		SellingLiabilities: 2.5, Flags: 3, LastModifiedLedger: 17,
		Deleted: false, ClosedAt: closedAt,
	}
	encoded, err := json.Marshal(transformed)
	if err != nil {
		t.Fatal(err)
	}
	update, include, err := decodeHolderIndexUpdate(
		"trustlines", 18, 7, closedAt, BatchIdentity{
			ID: holderTestBatch, SourceSHA256: holderTestDigest,
		}, encoded,
	)
	if err != nil || !include {
		t.Fatalf("official transform output failed holder decoding: include=%v err=%v json=%s", include, err, encoded)
	}
	if update.TrustlineLimit != transformed.TrustlineLimit || update.Balance != transformed.Balance || update.AssetKey != "USD:"+holderTestIssuer {
		t.Fatalf("official transform output changed during holder decoding: %#v", update)
	}
}

func TestPoolIndexCapturesLatestAlreadyEncodedPoolRow(t *testing.T) {
	var poolStages [][]byte
	client := holderTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Query().Get("query"), "._asset_pool_stage (") {
			body, _ := io.ReadAll(r.Body)
			poolStages = append(poolStages, body)
		}
		w.WriteHeader(http.StatusOK)
	}, true)
	writer, err := NewBatchWriter(client, BatchIdentity{ID: holderTestBatch, SourceSHA256: holderTestDigest, StartLedger: 10, EndLedger: 11}, WriterLimits{MaximumRows: 100, MaximumBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	row := func(reserve float64) json.RawMessage {
		encoded, _ := json.Marshal(map[string]any{
			"liquidity_pool_id": "pool-hex", "liquidity_pool_id_strkey": "LPOOL",
			"type": "constant_product", "fee": 30, "trustline_count": 7,
			"pool_share_count": 9.5, "asset_a_type": "native", "asset_a_amount": reserve,
			"asset_b_type": "credit_alphanum4", "asset_b_code": "USD", "asset_b_issuer": holderTestIssuer,
			"asset_b_amount": 20.25, "deleted": false, "closed_at": "2026-10-13T00:00:00Z", "last_modified_ledger": 9,
		})
		return encoded
	}
	if err := writer.Emit(context.Background(), "liquidity_pools", 10, row(10)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Emit(context.Background(), "liquidity_pools", 11, row(12)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(poolStages) != 1 {
		t.Fatalf("expected one pool stage insert, got %d", len(poolStages))
	}
	var staged struct {
		PoolID string            `json:"pool_id"`
		State  []json.RawMessage `json:"state"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(poolStages[0]), &staged); err != nil {
		t.Fatal(err)
	}
	if staged.PoolID != "pool-hex" || len(staged.State) != 21 {
		t.Fatalf("unexpected pool stage row: %#v", staged)
	}
	var reserve float64
	if err := json.Unmarshal(staged.State[13], &reserve); err != nil {
		t.Fatal(err)
	}
	if reserve != 12 {
		t.Fatalf("pool capture did not retain latest row: reserve=%v", reserve)
	}
}
