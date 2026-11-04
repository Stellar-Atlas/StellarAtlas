package backfill

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestHistoricalCapacityReleaseRetriesSameBatch(t *testing.T) {
	const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	first := currentWorkerTestBatch("11111111-1111-4111-8111-111111111111", 100, 163, digest)
	second := currentWorkerTestBatch("22222222-2222-4222-8222-222222222222", 164, 227, digest)
	head := currentWorkerTestBatch("33333333-3333-4333-8333-333333333333", 9_937, 10_000, digest)
	io := currentWorkerIO{
		history: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{first, second}, nil
		},
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
	}
	claims := newCurrentClaims()
	claims.observe([]catalog.Batch{head})
	selector := laneSelection{claims: claims, minimum: 1}

	selected, found, err := selector.next(context.Background(), io)
	if err != nil || !found || selected.ID != first.ID {
		t.Fatalf("first selection = %#v, %v, %v", selected, found, err)
	}
	selector.release(selected) // Capacity admission failed; retry the same boundary.
	retried, found, err := selector.next(context.Background(), io)
	if err != nil || !found || retried.ID != first.ID {
		t.Fatalf("retry selection = %#v, %v, %v; want first batch again", retried, found, err)
	}
}

func TestCurrentWorkerWaitsForReadinessRecoveryBeforeIngest(t *testing.T) {
	const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	batch := currentWorkerTestBatch("44444444-4444-4444-8444-444444444444", 9_937, 10_000, digest)
	probeStarted := make(chan struct{})
	probeRelease := make(chan struct{})
	ingestStarted := make(chan struct{}, 1)
	progress := make(chan struct{}, 1)
	var invalidateOnce sync.Once
	var stateMu sync.Mutex
	completed := make(map[string]string)
	guard := &WarehouseReadinessGuard{
		HealthyFor: time.Minute,
		Probe: func(ctx context.Context) error {
			close(probeStarted)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-probeRelease:
				return nil
			}
		},
	}
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) {
			invalidateOnce.Do(func() {
				guard.Invalidate(&clickhouse.RequestError{Err: errors.New("fixture warehouse request failed")})
			})
			return []catalog.Batch{batch}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) { return nil, nil },
		states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
			stateMu.Lock()
			defer stateMu.Unlock()
			state := emptyCurrentWorkerState()
			for _, id := range ids {
				if digest, ok := completed[id]; ok {
					state.Completed[id] = digest
				}
			}
			return state, nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		admit: func(context.Context, bool) error { return nil },
		ingest: func(_ context.Context, selected catalog.Batch) (ingestion.Receipt, error) {
			ingestStarted <- struct{}{}
			stateMu.Lock()
			completed[selected.ID] = selected.SourceSHA256
			stateMu.Unlock()
			return ingestion.Receipt{LedgerCount: selected.LedgerCount, RowCount: 1}, nil
		},
		wait: func(ctx context.Context) error {
			timer := time.NewTimer(time.Millisecond)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	config := Config{WorkerCount: 2, MinimumStartLedger: 1, ReadinessGuard: guard, OnProgress: func(Summary) {
		progress <- struct{}{}
	}}
	done := make(chan error, 1)
	go func() {
		_, err := runCurrentWorkers(ctx, config, io)
		done <- err
	}()

	select {
	case <-probeStarted:
	case <-ctx.Done():
		t.Fatal("readiness probe did not start before timeout")
	}
	select {
	case <-ingestStarted:
		t.Fatal("ingestion ran before readiness recovered")
	default:
	}
	close(probeRelease)
	select {
	case <-ingestStarted:
	case <-ctx.Done():
		t.Fatal("current ingestion did not start after readiness recovery")
	}
	select {
	case <-progress:
	case <-ctx.Done():
		t.Fatal("current ingestion did not complete after readiness recovery")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("runCurrentWorkers error = %v, want context cancellation", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("worker did not stop after cancellation")
	}
}

func TestCurrentMetadataFatalDoesNotCancelHistoricalImport(t *testing.T) {
	const (
		digest  = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
		changed = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	)
	history := currentWorkerTestBatch("55555555-5555-4555-8555-555555555555", 100, 163, digest)
	current := currentWorkerTestBatch("66666666-6666-4666-8666-666666666666", 9_937, 10_000, digest)
	allowChangedSnapshot := make(chan struct{})
	secondSnapshot := make(chan struct{})
	historyStarted := make(chan struct{})
	historyRelease := make(chan struct{})
	historyFinished := make(chan struct{})
	var mu sync.Mutex
	var recentCalls int
	var admissions int
	var ingested []string
	io := currentWorkerIO{
		recent: func(ctx context.Context) ([]catalog.Batch, error) {
			mu.Lock()
			recentCalls++
			call := recentCalls
			mu.Unlock()
			if call == 1 {
				return []catalog.Batch{current}, nil
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-allowChangedSnapshot:
			}
			close(secondSnapshot)
			modified := current
			modified.SourceSHA256 = changed
			return []catalog.Batch{modified}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{history}, nil },
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		admit: func(context.Context, bool) error {
			mu.Lock()
			admissions++
			mu.Unlock()
			return nil
		},
		ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			mu.Lock()
			ingested = append(ingested, batch.ID)
			mu.Unlock()
			if batch.ID == history.ID {
				close(historyStarted)
				select {
				case <-ctx.Done():
					close(historyFinished)
					return ingestion.Receipt{}, ctx.Err()
				case <-historyRelease:
					close(historyFinished)
					return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
				}
			}
			return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
		},
		wait: func(ctx context.Context) error {
			timer := time.NewTimer(time.Millisecond)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := runCurrentWorkers(ctx, Config{WorkerCount: 2, MinimumStartLedger: 1}, io)
		done <- err
	}()
	select {
	case <-historyStarted:
	case <-ctx.Done():
		t.Fatal("historical ingest did not start before timeout")
	}
	close(allowChangedSnapshot)
	select {
	case <-secondSnapshot:
	case <-ctx.Done():
		t.Fatal("changed catalog snapshot was not read")
	}
	time.Sleep(20 * time.Millisecond)
	select {
	case <-historyFinished:
		t.Fatal("fatal current metadata error canceled historical import")
	default:
	}
	if err := ctx.Err(); err != nil {
		t.Fatalf("parent import context was canceled by metadata error: %v", err)
	}
	mu.Lock()
	admissionsAtStop := admissions
	mu.Unlock()
	if admissionsAtStop < 3 {
		t.Fatalf("admission calls before fatal error = %d, want both lanes and current retry", admissionsAtStop)
	}
	close(historyRelease)
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "changed immutable digest") {
			t.Fatalf("runCurrentWorkers error = %v, want immutable digest failure", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("workers did not finish after releasing history")
	}
	mu.Lock()
	defer mu.Unlock()
	if admissions != admissionsAtStop {
		t.Errorf("admission calls changed from %d to %d after fatal error", admissionsAtStop, admissions)
	}
	if len(ingested) != 2 || ingested[0] == ingested[1] {
		t.Errorf("ingested batches = %v, want one current and one history batch", ingested)
	}
}

func TestCancellationAfterSelectionDoesNotIngest(t *testing.T) {
	const digest = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	batch := currentWorkerTestBatch("77777777-7777-4777-8777-777777777777", 9_937, 10_000, digest)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var once sync.Once
	var ingests int
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) {
			once.Do(cancel)
			return []catalog.Batch{batch}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) { return nil, nil },
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		admit: func(context.Context, bool) error { return nil },
		wait: func(ctx context.Context) error {
			timer := time.NewTimer(time.Millisecond)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		},
		ingest: func(context.Context, catalog.Batch) (ingestion.Receipt, error) {
			ingests++
			return ingestion.Receipt{LedgerCount: 64}, nil
		},
	}
	_, err := runCurrentWorkers(ctx, Config{WorkerCount: 2, MinimumStartLedger: 1}, io)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("runCurrentWorkers error = %v, want context cancellation", err)
	}
	if ingests != 0 {
		t.Fatalf("ingests = %d, want none after cancellation", ingests)
	}
}

func emptyCurrentWorkerState() clickhouse.BatchAdmissionSnapshot {
	return clickhouse.BatchAdmissionSnapshot{
		Completed:  make(map[string]string),
		Incomplete: make(map[string]string),
	}
}
