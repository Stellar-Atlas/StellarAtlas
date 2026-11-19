package clickhouse

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	budgetTestInsert      = "INSERT INTO `budget_test`.`history_ledgers` FORMAT JSONEachRow"
	budgetTestStatus      = "INSERT INTO `budget_test`._ingestion_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
	budgetTestIndexStatus = "INSERT INTO `budget_test`._asset_holder_index_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
	budgetTestHolderStage = "INSERT INTO `budget_test`._asset_holder_stage (asset_key, account_id, state, batch_id, source_sha256) FORMAT JSONEachRow"
	budgetTestPoolStage   = "INSERT INTO `budget_test`._asset_pool_stage (pool_id,state,batch_id,source_sha256) FORMAT JSONEachRow"
	budgetTestHolder      = "INSERT INTO `budget_test`._asset_holder_current (asset_key, account_id, state) SELECT asset_key, account_id, max(state) FROM `budget_test`._asset_holder_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY asset_key, account_id"
	budgetTestPool        = "INSERT INTO `budget_test`._asset_pool_current (pool_id,state) SELECT pool_id,max(state) FROM `budget_test`._asset_pool_stage WHERE batch_id={batch:UUID} AND source_sha256={digest:String} GROUP BY pool_id"
)

func budgetTestClient(t *testing.T, roundTrip endpointTestTransport) *Client {
	t.Helper()
	client, err := New(Config{Endpoint: "http://warehouse.invalid", Database: "budget_test", HTTPClient: &http.Client{Transport: roundTrip}})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func budgetTestContext(t *testing.T, limit uint64, check func(context.Context) error) context.Context {
	t.Helper()
	ctx, err := WithCurrentWriteBudget(t.Context(), limit, check)
	if err != nil {
		t.Fatal(err)
	}
	return ctx
}

func budgetTestResponse(req *http.Request) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok")), Request: req}
}

func TestCurrentWriteBudgetRefusesBeforeTransport(t *testing.T) {
	var requests, checks int
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		requests++
		return budgetTestResponse(req), nil
	})
	capacityErr := errors.New("fresh capacity refused")
	ctx := budgetTestContext(t, currentWriteStatusReserve+(16<<10), func(context.Context) error {
		checks++
		return capacityErr
	})
	for _, tc := range []struct {
		query string
		body  []byte
		cause error
	}{
		{budgetTestInsert, []byte("row"), capacityErr},
		{budgetTestInsert, nil, nil},
		{budgetTestInsert, make([]byte, 16<<10), ErrCurrentWriteBudgetExceeded},
		{"DROP TABLE `budget_test`.`history_ledgers`", nil, nil},
		{"insert into `budget_test`.`history_ledgers` FORMAT JSONEachRow", []byte("row"), nil},
		{"INSERT INTO `budget_test`.`history_ledgers` SELECT * FROM `budget_test`.`source`", []byte("dummy"), nil},
	} {
		_, err := client.execute(ctx, tc.query, nil, tc.body)
		var reqErr *RequestError
		if !errors.As(err, &reqErr) || tc.cause != nil && !errors.Is(err, tc.cause) {
			t.Errorf("%s: expected classified refusal (%v), got %v", tc.query, tc.cause, err)
		}
	}
	if _, err := client.execute(ctx, "SELECT 1", nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.execute(t.Context(), "DROP TABLE unguarded", nil, nil); err != nil {
		t.Fatal(err)
	}
	if requests != 2 || checks != 1 {
		t.Fatalf("expected two unchanged requests and one valid fresh check, got %d requests / %d checks", requests, checks)
	}
}

func TestCurrentWriteBudgetConcurrentChargesAndManifestReserve(t *testing.T) {
	dataEntered := make(chan struct{}, 2)
	releaseData := make(chan struct{})
	release := sync.OnceFunc(func() { close(releaseData) })
	defer release()
	var checks atomic.Int32
	var statuses atomic.Int32
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		if query := req.URL.Query().Get("query"); query == budgetTestStatus || query == budgetTestIndexStatus {
			statuses.Add(1)
		} else {
			dataEntered <- struct{}{}
			<-releaseData
		}
		return budgetTestResponse(req), nil
	})
	ctx := budgetTestContext(t, currentWriteStatusReserve+(16<<10), func(context.Context) error {
		checks.Add(1)
		return nil
	})
	first := make(chan error, 1)
	go func() {
		_, err := client.execute(ctx, budgetTestInsert, nil, make([]byte, 4096))
		first <- err
	}()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-dataEntered:
	case <-timer.C:
		t.Fatal("the one admitted write did not enter HTTP")
	}
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := client.execute(ctx, budgetTestInsert, nil, make([]byte, 4096))
			results <- err
		}()
	}
	for range 2 {
		select {
		case err := <-results:
			if !errors.Is(err, ErrCurrentWriteInFlight) {
				t.Fatalf("expected overlap refusal before probe/HTTP, got %v", err)
			}
		case <-timer.C:
			t.Fatal("overlapping writes did not refuse while the first request was active")
		}
	}
	if _, err := client.execute(ctx, budgetTestStatus, nil, []byte("status")); !errors.Is(err, ErrCurrentWriteInFlight) {
		t.Fatalf("status INSERT overlapped the active data request: %v", err)
	}
	if checks.Load() != 1 || statuses.Load() != 0 || len(dataEntered) != 0 {
		t.Fatal("refused overlaps reached a fresh probe or HTTP")
	}
	release()
	select {
	case err := <-first:
		if err != nil {
			t.Fatal(err)
		}
	case <-timer.C:
		t.Fatal("the admitted write did not return after release")
	}
	// Confirmed settlement admits a subsequent request, without refunding the
	// first request's charge. Two total data writes exhaust this fixture quota.
	if _, err := client.execute(ctx, budgetTestInsert, nil, make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("settlement refunded data quota: %v", err)
	}
	if _, err := client.execute(ctx, budgetTestStatus, nil, make([]byte, currentWriteStatusBytes-currentWriteOverhead+1)); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("oversized status was not rejected: %v", err)
	}
	for range 3 {
		if _, err := client.execute(ctx, budgetTestStatus, nil, make([]byte, currentWriteStatusBytes-currentWriteOverhead)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := client.execute(ctx, budgetTestStatus, nil, []byte("one more")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("fourth status was not rejected: %v", err)
	}
	if checks.Load() != 5 || statuses.Load() != 3 {
		t.Fatalf("got %d fresh checks and %d statuses", checks.Load(), statuses.Load())
	}
}

func TestCurrentWriteBudgetPromotionNeedsMatchingStageOnlyOnce(t *testing.T) {
	var requests int
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		requests++
		return budgetTestResponse(req), nil
	})
	ctx := budgetTestContext(t, currentWriteStatusReserve+2*currentWriteOverhead+20, func(context.Context) error { return nil })
	for _, query := range []string{budgetTestHolder, budgetTestPool} {
		if _, err := client.execute(ctx, query, nil, nil); err == nil {
			t.Fatal("unstaged promotion was admitted")
		}
	}
	if _, err := client.execute(ctx, budgetTestHolderStage, nil, make([]byte, 10)); err != nil {
		t.Fatal(err)
	}
	if _, err := client.execute(ctx, budgetTestPool, nil, nil); err == nil {
		t.Fatal("holder staged bytes enabled pool promotion")
	}
	if _, err := client.execute(ctx, budgetTestHolder+" LIMIT 1", nil, nil); err == nil {
		t.Fatal("a noncanonical promotion was admitted")
	}
	if _, err := client.execute(ctx, budgetTestHolder, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.execute(ctx, budgetTestHolder, nil, nil); err == nil {
		t.Fatal("duplicate holder promotion was admitted")
	}
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) || requests != 2 {
		t.Fatalf("stage bytes must count twice, and promotion exactly once: requests=%d err=%v", requests, err)
	}
}

func TestCurrentWriteBudgetRequiresExactPoolStageAndPromotionSQL(t *testing.T) {
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		if req.URL.Query().Get("async_insert") != "0" {
			t.Error("guarded read-model write did not pin synchronous HTTP settings")
		}
		return budgetTestResponse(req), nil
	})
	ctx := budgetTestContext(t, currentWriteStatusReserve+(4*currentWriteOverhead)+(4*10), func(context.Context) error { return nil })
	if _, err := client.execute(ctx, budgetTestPoolStage, nil, make([]byte, 10)); err != nil {
		t.Fatalf("exact pool stage INSERT was refused: %v", err)
	}
	if _, err := client.execute(ctx, budgetTestPoolStage, nil, make([]byte, 10)); err != nil {
		t.Fatalf("a subsequent stage request recharged earlier stage exposure: %v", err)
	}
	if _, err := client.execute(ctx, strings.Replace(budgetTestPoolStage, " FORMAT", " SETTINGS async_insert=1 FORMAT", 1), nil, make([]byte, 10)); err == nil {
		t.Fatal("pool stage INSERT with explicit async override was admitted")
	}
	if _, err := client.execute(ctx, budgetTestPool, nil, nil); err != nil {
		t.Fatalf("exact pool promotion INSERT SELECT was refused: %v", err)
	}
	if _, err := client.execute(ctx, budgetTestPool+" LIMIT 1", nil, nil); err == nil {
		t.Fatal("noncanonical pool promotion was admitted")
	}
}

func TestCurrentWriteBudgetDoesNotRefundAmbiguousSubmission(t *testing.T) {
	var requests, checks int
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return nil, io.ErrUnexpectedEOF
		}
		return budgetTestResponse(req), nil
	})
	ctx := budgetTestContext(t, currentWriteStatusReserve+currentWriteOverhead+1, func(context.Context) error {
		checks++
		return nil
	})
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("expected simulated ambiguous submission, got %v", err)
	}
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteUncertain) || requests != 1 {
		t.Fatalf("submitted bytes were refunded: requests=%d err=%v", requests, err)
	}
	var freshChecks int
	fresh := budgetTestContext(t, currentWriteStatusReserve+(16<<10), func(context.Context) error {
		freshChecks++
		return nil
	})
	if _, err := client.execute(fresh, budgetTestInsert, nil, []byte("fresh")); !errors.Is(err, ErrCurrentWriteUncertain) {
		t.Fatalf("a new File budget cleared the client's uncertain request: %v", err)
	}
	// Even policy validation/metadata probing must remain behind quarantine.
	if err := client.CheckCurrentPublicationBulkReserve(fresh, HistoricalStoragePolicy{}); !errors.Is(err, ErrCurrentWriteUncertain) {
		t.Fatalf("current capacity did not refuse before any fresh probe: %v", err)
	}
	if requests != 1 || checks != 1 || freshChecks != 0 {
		t.Fatal("quarantined current work reached HTTP or a fresh capacity callback")
	}
	if _, err := client.execute(fresh, "SELECT 1", nil, nil); err != nil {
		t.Fatalf("quarantine blocked read-only SQL: %v", err)
	}
	if _, err := client.execute(t.Context(), budgetTestInsert, nil, []byte("historical")); err != nil {
		t.Fatalf("quarantine changed unguarded historical behavior: %v", err)
	}
	if requests != 3 || checks != 1 || freshChecks != 0 {
		t.Fatal("SELECT/historical requests changed guarded admission counters")
	}
}

func TestCurrentWriteBudgetChecksCancellationAfterCapacity(t *testing.T) {
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		t.Fatal("canceled insert reached transport")
		return nil, nil
	})
	var cancel context.CancelFunc
	ctx := budgetTestContext(t, currentWriteStatusReserve+(16<<10), func(context.Context) error {
		cancel()
		return nil
	})
	ctx, cancel = context.WithCancel(ctx)
	defer cancel()
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

func TestCurrentWriteBudgetBoundsFreshChecks(t *testing.T) {
	var checks int
	capacityErr := errors.New("fresh capacity refused")
	ctx := budgetTestContext(t, currentWriteMaxBytes, func(context.Context) error {
		checks++
		return capacityErr
	})
	for range currentWriteMaxRequests - currentWriteReservedRequests {
		if err := budgetTestAdmitConfirmed(ctx, budgetTestInsert, 1); !errors.Is(err, capacityErr) {
			t.Fatalf("fresh check failed to run: %v", err)
		}
	}
	if err := budgetTestAdmitConfirmed(ctx, budgetTestInsert, 1); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("data check limit was not enforced: %v", err)
	}
	for range currentWriteStatusCount {
		if err := budgetTestAdmitConfirmed(ctx, budgetTestStatus, 1); !errors.Is(err, capacityErr) {
			t.Fatalf("reserved manifest check failed to run: %v", err)
		}
	}
	for range currentWriteIndexStatusCount {
		if err := budgetTestAdmitConfirmed(ctx, budgetTestIndexStatus, 1); !errors.Is(err, capacityErr) {
			t.Fatalf("reserved read-model status check failed to run: %v", err)
		}
	}
	if err := budgetTestAdmitConfirmed(ctx, budgetTestStatus, 1); !errors.Is(err, ErrCurrentWriteBudgetExceeded) || checks != currentWriteMaxRequests {
		t.Fatalf("total check limit was not enforced: checks=%d err=%v", checks, err)
	}
}

func TestCurrentWriteBudgetChargesActualNativeFallbackBody(t *testing.T) {
	write := func(ctx context.Context, capture *effectsTestCapture) error {
		w := nativeTestWriter(t, true, false, 0, 3, 0, capture)
		custom := &typedFallbackStatefulMarshaler{failAfterFirst: true}
		if err := w.Emit(ctx, "history_effects", 1, typedFallbackFixture("details", custom, 0)); err != nil {
			return err
		}
		return w.Flush(ctx)
	}
	var baseline effectsTestCapture
	if err := write(t.Context(), &baseline); err != nil || len(baseline.calls) != 1 || !strings.HasSuffix(baseline.calls[0].query, " FORMAT Native") {
		t.Fatalf("expected one actual fallback Native submission, got %d requests, %v", len(baseline.calls), err)
	}
	exact := uint64(currentWriteStatusReserve + currentWriteOverhead + len(baseline.calls[0].body))
	check := func(context.Context) error { return nil }
	var admitted, refused effectsTestCapture
	if err := write(budgetTestContext(t, exact, check), &admitted); err != nil || len(admitted.calls) != 1 {
		t.Fatalf("exact final wire length should fit once, got %d requests, %v", len(admitted.calls), err)
	}
	if err := write(budgetTestContext(t, exact-1, check), &refused); !errors.Is(err, ErrCurrentWriteBudgetExceeded) || len(refused.calls) != 0 {
		t.Fatalf("one byte short should refuse before HTTP, got %d requests, %v", len(refused.calls), err)
	}
}

// Test-only shim for old assertions which inspect admission rather than HTTP.
// Production Client must settle only after its full synchronous response.
func budgetTestAdmitConfirmed(ctx context.Context, query string, bodyLen int) error {
	settle, err := admitCurrentWrite(ctx, "`budget_test`", query, bodyLen)
	if err == nil && settle != nil {
		settle(true)
	}
	return err
}

func TestCurrentWriteBudgetRequestSettlementLifecycle(t *testing.T) {
	var checks int
	ctx := budgetTestContext(t, currentWriteStatusReserve+8*currentWriteOverhead+100, func(ctx context.Context) error {
		checks++
		logical, _, err := CurrentRequestExposureFromContext(ctx)
		if err != nil || logical != currentWriteOverhead+10 {
			t.Fatalf("missing exact prospective request exposure: bytes=%d err=%v", logical, err)
		}
		return nil
	})
	budget := ctx.Value(currentWriteBudgetKey{}).(*currentWriteBudget)
	original := budget.dataRemaining
	if err := budgetTestAdmitConfirmed(ctx, budgetTestInsert, 10); err != nil {
		t.Fatal(err)
	}
	if budget.inFlight || budget.uncertain || budget.dataRemaining != original-currentWriteOverhead-10 {
		t.Fatal("confirmed preflight-only settlement refunded quota or left a latch")
	}
	settle, err := admitCurrentWrite(ctx, "`budget_test`", budgetTestInsert, 10)
	if err != nil || settle == nil {
		t.Fatalf("next request was not admitted: %v", err)
	}
	remaining, requestChecks := budget.dataRemaining, budget.dataChecks
	if rejected, err := admitCurrentWrite(ctx, "`budget_test`", budgetTestInsert, 10); rejected != nil || !errors.Is(err, ErrCurrentWriteInFlight) {
		t.Fatalf("in-flight request was not fenced: %v", err)
	}
	if checks != 2 || budget.dataRemaining != remaining || budget.dataChecks != requestChecks {
		t.Fatal("in-flight refusal reached a callback or changed counters")
	}
	settle(true)
	settle(false) // sync.Once must not poison a request already confirmed.
	if budget.inFlight || budget.uncertain || budget.dataRemaining != remaining {
		t.Fatal("confirmed settlement changed quota or was settled twice")
	}
	uncertain, err := admitCurrentWrite(ctx, "`budget_test`", budgetTestInsert, 10)
	if err != nil || uncertain == nil {
		t.Fatalf("request before uncertainty was not admitted: %v", err)
	}
	remaining, requestChecks = budget.dataRemaining, budget.dataChecks
	statusChecks := budget.statusChecks
	uncertain(false)
	uncertain(true) // A later success cannot clear an uncertain first outcome.
	if !budget.inFlight || !budget.uncertain || budget.dataRemaining != remaining ||
		budget.dataChecks != requestChecks || budget.statusChecks != statusChecks {
		t.Fatal("uncertain settlement refunded quota or cleared its sticky fence")
	}
	for _, query := range []string{budgetTestInsert, budgetTestStatus} {
		if rejected, err := admitCurrentWrite(ctx, "`budget_test`", query, 10); rejected != nil || !errors.Is(err, ErrCurrentWriteUncertain) {
			t.Fatalf("uncertain attempt admitted a later INSERT: %v", err)
		}
	}
	if checks != 3 || budget.dataChecks != requestChecks || budget.statusChecks != statusChecks ||
		budget.dataRemaining != original-3*(currentWriteOverhead+10) {
		t.Fatal("uncertain refusal changed callbacks, data quota or status reserves")
	}
	if readSettlement, err := admitCurrentWrite(ctx, "`budget_test`", "SELECT 1", 0); err != nil || readSettlement != nil {
		t.Fatalf("read-only SELECT was blocked by uncertain INSERT state: %v", err)
	}
}
