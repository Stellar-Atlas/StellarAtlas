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
	results := make(chan error, 3)
	for range 3 {
		go func() {
			_, err := client.execute(ctx, budgetTestInsert, nil, make([]byte, 4096))
			results <- err
		}()
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for range 2 {
		select {
		case <-dataEntered:
		case <-timer.C:
			t.Fatal("two admitted writes should enter HTTP concurrently")
		}
	}
	select {
	case err := <-results:
		if !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
			t.Fatalf("expected budget refusal for the third write, got %v", err)
		}
	case <-timer.C:
		t.Fatal("overcommit must be refused while the two writes remain in flight")
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
	release()
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-timer.C:
			t.Fatal("admitted writes did not return")
		}
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
	var requests int
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		requests++
		return nil, io.ErrUnexpectedEOF
	})
	ctx := budgetTestContext(t, currentWriteStatusReserve+currentWriteOverhead+1, func(context.Context) error { return nil })
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("expected simulated ambiguous submission, got %v", err)
	}
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) || requests != 1 {
		t.Fatalf("submitted bytes were refunded: requests=%d err=%v", requests, err)
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
	client := budgetTestClient(t, func(req *http.Request) (*http.Response, error) {
		t.Fatal("capacity-refused insert reached transport")
		return nil, nil
	})
	ctx := budgetTestContext(t, currentWriteMaxBytes, func(context.Context) error {
		checks++
		return capacityErr
	})
	for range currentWriteMaxRequests - currentWriteReservedRequests {
		if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, capacityErr) {
			t.Fatalf("fresh check failed to run: %v", err)
		}
	}
	if _, err := client.execute(ctx, budgetTestInsert, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("data check limit was not enforced: %v", err)
	}
	for range currentWriteStatusCount {
		if _, err := client.execute(ctx, budgetTestStatus, nil, []byte("x")); !errors.Is(err, capacityErr) {
			t.Fatalf("reserved manifest check failed to run: %v", err)
		}
	}
	for range currentWriteIndexStatusCount {
		if _, err := client.execute(ctx, budgetTestIndexStatus, nil, []byte("x")); !errors.Is(err, capacityErr) {
			t.Fatalf("reserved read-model status check failed to run: %v", err)
		}
	}
	if _, err := client.execute(ctx, budgetTestStatus, nil, []byte("x")); !errors.Is(err, ErrCurrentWriteBudgetExceeded) || checks != currentWriteMaxRequests {
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
