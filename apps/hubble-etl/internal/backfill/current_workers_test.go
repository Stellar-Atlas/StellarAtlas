package backfill

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestCurrentWorkersAdvanceTwiceWhileHistoryIsBlocked(t *testing.T) {
	const (
		historyID  = "11111111-1111-4111-8111-111111111111"
		currentAID = "22222222-2222-4222-8222-222222222222"
		currentBID = "33333333-3333-4333-8333-333333333333"
		digest     = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	)
	historyBatch := currentWorkerTestBatch(historyID, 100, 163, digest)
	currentA := currentWorkerTestBatch(currentAID, 9_873, 9_936, digest)
	currentB := currentWorkerTestBatch(currentBID, 9_937, 10_000, digest)

	var mu sync.Mutex
	completed := make(map[string]string)
	incomplete := make(map[string]string)
	ingested := make([]string, 0, 3)
	var active atomic.Int32
	var maximumActive atomic.Int32
	var recentReads atomic.Int32
	var capacityChecks atomic.Int32
	updateActive := func() func() {
		value := active.Add(1)
		for previous := maximumActive.Load(); value > previous && !maximumActive.CompareAndSwap(previous, value); previous = maximumActive.Load() {
		}
		return func() { active.Add(-1) }
	}

	historyStarted := make(chan struct{})
	historyFinished := make(chan struct{})
	currentProgress := make(chan string, 2)
	io := currentWorkerIO{
		recent: func(ctx context.Context) ([]catalog.Batch, error) {
			if recentReads.Add(1) == 1 {
				return nil, context.DeadlineExceeded
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			default:
			}
			mu.Lock()
			defer mu.Unlock()
			if _, ok := completed[currentAID]; ok {
				return []catalog.Batch{currentB}, nil
			}
			return []catalog.Batch{currentA}, nil
		},
		history: func(ctx context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{historyBatch}, nil
		},
		states: func(ctx context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
			mu.Lock()
			defer mu.Unlock()
			state := clickhouse.BatchAdmissionSnapshot{Completed: make(map[string]string), Incomplete: make(map[string]string)}
			for _, id := range ids {
				if digest, ok := completed[id]; ok {
					state.Completed[id] = digest
				}
				if digest, ok := incomplete[id]; ok {
					state.Incomplete[id] = digest
				}
			}
			return state, nil
		},
		allStates: func(ctx context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			mu.Lock()
			defer mu.Unlock()
			state := clickhouse.BatchAdmissionSnapshot{Completed: make(map[string]string), Incomplete: make(map[string]string)}
			for id, value := range completed {
				state.Completed[id] = value
			}
			for id, value := range incomplete {
				state.Incomplete[id] = value
			}
			return state, nil
		},
		admit: func(context.Context, bool) error { return nil },
		capacity: func(context.Context) error {
			if capacityChecks.Add(1) == 1 {
				return fmt.Errorf("temporary free-space probe failure")
			}
			return nil
		},
		ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			finishActive := updateActive()
			defer finishActive()
			mu.Lock()
			ingested = append(ingested, batch.ID)
			mu.Unlock()
			if batch.ID == historyID {
				close(historyStarted)
				<-ctx.Done()
				close(historyFinished)
				return ingestion.Receipt{}, ctx.Err()
			}
			mu.Lock()
			completed[batch.ID] = batch.SourceSHA256
			mu.Unlock()
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
	config := Config{WorkerCount: 2, MinimumStartLedger: 1, OnProgress: func(summary Summary) {
		currentProgress <- summary.LastCompletedBatchID
	}}
	go func() {
		_, err := runCurrentWorkers(ctx, config, io)
		done <- err
	}()

	select {
	case <-historyStarted:
	case <-ctx.Done():
		t.Fatal("historical ingest did not start before timeout")
	}
	for _, wantID := range []string{currentAID, currentBID} {
		select {
		case gotID := <-currentProgress:
			if gotID != wantID {
				t.Fatalf("current completion = %s, want %s", gotID, wantID)
			}
		case <-ctx.Done():
			t.Fatalf("current batches did not both complete: %v", ctx.Err())
		}
	}
	select {
	case <-historyFinished:
		t.Fatal("historical ingest finished before cancellation")
	default:
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("runCurrentWorkers error = %v, want context cancellation", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("workers did not stop after context cancellation")
	}

	mu.Lock()
	defer mu.Unlock()
	counts := make(map[string]int)
	for _, id := range ingested {
		counts[id]++
	}
	for _, id := range []string{historyID, currentAID, currentBID} {
		if counts[id] != 1 {
			t.Errorf("batch %s ingested %d times, want once", id, counts[id])
		}
	}
	if len(ingested) != 3 {
		t.Errorf("ingested IDs = %v, want exactly three unique batches", ingested)
	}
	if got := maximumActive.Load(); got > 2 {
		t.Errorf("maximum active imports = %d, want at most two", got)
	}
}

func TestCurrentClaimsDeduplicateAndSeparateTheWindow(t *testing.T) {
	const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	current := currentWorkerTestBatch("44444444-4444-4444-8444-444444444444", 9_937, 10_000, digest)
	history := currentWorkerTestBatch("55555555-5555-4555-8555-555555555555", 100, 163, digest)
	boundary := currentWorkerTestBatch("66666666-6666-4666-8666-666666666666", 5_841, 5_904, digest)
	claims := newCurrentClaims()
	claims.observe([]catalog.Batch{current, history, boundary})

	if reserved, err := claims.reserve(current, true); err != nil || !reserved {
		t.Fatalf("current reservation = %v, %v; want reserved", reserved, err)
	}
	if reserved, err := claims.reserve(current, true); err != nil || reserved {
		t.Fatalf("duplicate current reservation = %v, %v; want not reserved", reserved, err)
	}
	changed := current
	changed.SourceSHA256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	if _, err := claims.reserve(changed, true); err == nil {
		t.Fatal("changed immutable digest was accepted")
	}
	claims.finish(current)
	if reserved, err := claims.reserve(current, true); err != nil || reserved {
		t.Fatalf("resolved current reservation = %v, %v; want quarantined", reserved, err)
	}
	if reserved, err := claims.reserve(history, true); err != nil || reserved {
		t.Fatalf("historical batch claimed by current lane = %v, %v", reserved, err)
	}
	if reserved, err := claims.reserve(boundary, true); err != nil || reserved {
		t.Fatalf("window-boundary batch claimed as current = %v, %v", reserved, err)
	}
	if reserved, err := claims.reserve(history, false); err != nil || !reserved {
		t.Fatalf("historical reservation = %v, %v; want reserved", reserved, err)
	}
}

func currentWorkerTestBatch(id string, start, end uint32, digest string) catalog.Batch {
	return catalog.Batch{
		ID:           id,
		StartLedger:  start,
		EndLedger:    end,
		LedgerCount:  end - start + 1,
		StorageKey:   id + ".json",
		SourceSHA256: digest,
	}
}
