package backfill

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestThreeWorkersReserveOneCurrentAndDrainTwoDisjointHistoricalImports(t *testing.T) {
	const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	first := currentWorkerTestBatch("11111111-1111-4111-8111-111111111111", 100, 163, digest)
	second := currentWorkerTestBatch("22222222-2222-4222-8222-222222222222", 164, 227, digest)
	current := currentWorkerTestBatch("33333333-3333-4333-8333-333333333333", 9_937, 10_000, digest)
	started := make(chan string, 3)
	release := make(chan struct{})
	drain := make(chan struct{})
	var active, maximum atomic.Int32
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{current}, nil },
		history: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{first, second, current}, nil
		},
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		admit:    func(context.Context, bool) error { return nil },
		capacity: func(context.Context) error { return nil },
		wait:     func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
		ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			n := active.Add(1)
			for previous := maximum.Load(); n > previous && !maximum.CompareAndSwap(previous, n); previous = maximum.Load() {
			}
			defer active.Add(-1)
			started <- batch.ID
			select {
			case <-ctx.Done():
				return ingestion.Receipt{}, ctx.Err()
			case <-release:
				return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
			}
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	type outcome struct {
		summary Summary
		err     error
	}
	done := make(chan outcome, 1)
	go func() {
		summary, err := runCurrentWorkers(ctx, Config{WorkerCount: 3, MinimumStartLedger: 1, Drain: drain}, io)
		done <- outcome{summary, err}
	}()
	seen := make(map[string]int)
	for range 3 {
		select {
		case id := <-started:
			seen[id]++
		case <-ctx.Done():
			t.Fatal("three disjoint imports did not run concurrently")
		}
	}
	for _, batch := range []catalog.Batch{first, second, current} {
		if seen[batch.ID] != 1 {
			t.Fatalf("batch %s started %d times", batch.ID, seen[batch.ID])
		}
	}
	close(drain)
	select {
	case <-done:
		t.Fatal("drain returned before admitted imports completed")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case got := <-done:
		if got.err != nil || got.summary.IngestedBatches != 3 || maximum.Load() != 3 {
			t.Fatalf("summary=%+v err=%v maximum=%d", got.summary, got.err, maximum.Load())
		}
	case <-ctx.Done():
		t.Fatal("drained workers did not finish")
	}
	if active.Load() != 0 || ctx.Err() != nil {
		t.Fatal("drain canceled imports or leaked workers")
	}
}

func TestSharedHistoryReleaseRewindsEarlierReservation(t *testing.T) {
	const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	first := currentWorkerTestBatch("44444444-4444-4444-8444-444444444444", 100, 163, digest)
	second := currentWorkerTestBatch("55555555-5555-4555-8555-555555555555", 164, 227, digest)
	claims := newCurrentClaims()
	claims.observe([]catalog.Batch{currentWorkerTestBatch("66666666-6666-4666-8666-666666666666", 9_937, 10_000, digest)})
	selector := laneSelection{claims: claims, minimum: 1}
	historyReads := 0
	io := currentWorkerIO{
		history: func(context.Context) ([]catalog.Batch, error) {
			historyReads++
			return []catalog.Batch{first, second}, nil
		},
		states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			return emptyCurrentWorkerState(), nil
		},
	}
	for _, want := range []catalog.Batch{first, second} {
		if got, found, err := selector.next(context.Background(), io); err != nil || !found || got.ID != want.ID {
			t.Fatalf("selection=%s found=%v err=%v want=%s", got.ID, found, err, want.ID)
		}
	}
	selector.loadedAt = time.Now().Add(-6 * time.Minute)
	if _, found, err := selector.next(context.Background(), io); err != nil || found || historyReads != 1 {
		t.Fatalf("active reservation snapshot refreshed: found=%v reads=%d err=%v", found, historyReads, err)
	}
	selector.release(first)
	if got, found, err := selector.next(context.Background(), io); err != nil || !found || got.ID != first.ID {
		t.Fatalf("released earlier reservation was skipped: %s %v %v", got.ID, found, err)
	}
	if len(selector.reserved) != 2 {
		t.Fatalf("active reservation count=%d", len(selector.reserved))
	}
	selector.finish(first)
	selector.finish(second)
	if len(selector.reserved) != 0 {
		t.Fatal("finished reservation bookkeeping leaked")
	}
}
