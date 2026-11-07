package backfill

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestHistoryHoldDefersBothHistoryLanesWhileCurrentAdvances(t *testing.T) {
	const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	history := currentWorkerTestBatch("11111111-1111-4111-8111-111111111111", 100, 163, digest)
	currentA := currentWorkerTestBatch("22222222-2222-4222-8222-222222222222", 9_873, 9_936, digest)
	currentB := currentWorkerTestBatch("33333333-3333-4333-8333-333333333333", 9_937, 10_000, digest)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var held atomic.Bool
	held.Store(true)
	waiting := make(chan struct{}, 2)
	removed := make(chan struct{})
	hold := &HistoryAdmissionHold{
		MarkerPath: "/operator/history-hold",
		probe: func(string) string {
			if held.Load() {
				return "marker present"
			}
			return ""
		},
		wait: func(ctx context.Context) error {
			waiting <- struct{}{}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-removed:
				return nil
			}
		},
	}
	var historyReads, historyStates, allStates, historyAdmissions, baselineAdmissions atomic.Int32
	progress := make(chan string, 3)
	drain := make(chan struct{})
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{currentA, currentB}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) {
			historyReads.Add(1)
			return []catalog.Batch{history, currentA, currentB}, nil
		},
		states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
			for _, id := range ids {
				if id == history.ID {
					historyStates.Add(1)
				}
			}
			return emptyCurrentWorkerState(), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			allStates.Add(1)
			return emptyCurrentWorkerState(), nil
		},
		admit: func(_ context.Context, current bool) error {
			if !current {
				historyAdmissions.Add(1)
			}
			return nil
		},
		baselineAdmit: func(context.Context) error { baselineAdmissions.Add(1); return nil },
		ingest: func(_ context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
		},
		wait: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
	}
	done := make(chan error, 1)
	go func() {
		_, err := runCurrentWorkers(ctx, Config{
			WorkerCount: 3, MinimumStartLedger: 1, Drain: drain,
			BaselineHistoryPressureGuard: &PressureGuard{}, HistoryAdmissionHold: hold,
			OnProgress: func(summary Summary) {
				progress <- summary.LastCompletedBatchID
				if summary.LastCompletedBatchID == history.ID {
					close(drain)
				}
			},
		}, io)
		done <- err
	}()
	for range 2 {
		select {
		case <-waiting:
		case <-ctx.Done():
			t.Fatal("ordinary and baseline history lanes did not both wait on the hold")
		}
	}
	seen := make(map[string]bool)
	for range 2 {
		select {
		case id := <-progress:
			seen[id] = true
		case <-ctx.Done():
			t.Fatal("current lane did not advance twice while history was held")
		}
	}
	if !seen[currentA.ID] || !seen[currentB.ID] {
		t.Fatalf("completed while held = %v, want both current batches", seen)
	}
	if historyReads.Load() != 0 || historyStates.Load() != 0 || allStates.Load() != 0 ||
		historyAdmissions.Load() != 0 || baselineAdmissions.Load() != 0 {
		t.Fatal("held history reached pressure admission, catalog, or state selection")
	}
	held.Store(false)
	close(removed)
	select {
	case id := <-progress:
		if id != history.ID {
			t.Fatalf("resumed batch = %s, want history", id)
		}
	case <-ctx.Done():
		t.Fatal("marker removal did not resume historical ingestion")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("drained workers returned %v", err)
		}
	case <-ctx.Done():
		t.Fatal("workers did not drain after history resumed")
	}
}

func TestHistoryHoldLetsAdmittedImportFinishAndDrainsNextAdmission(t *testing.T) {
	const digest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	history := currentWorkerTestBatch("44444444-4444-4444-8444-444444444444", 100, 163, digest)
	next := currentWorkerTestBatch("55555555-5555-4555-8555-555555555555", 164, 227, digest)
	head := currentWorkerTestBatch("66666666-6666-4666-8666-666666666666", 9_937, 10_000, digest)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var held atomic.Bool
	started := make(chan struct{})
	release := make(chan struct{})
	waiting := make(chan struct{}, 1)
	drain := make(chan struct{})
	var imports atomic.Int32
	hold := &HistoryAdmissionHold{
		MarkerPath: "/operator/history-hold",
		probe: func(string) string {
			if held.Load() {
				return "marker present"
			}
			return ""
		},
		wait: func(ctx context.Context) error {
			waiting <- struct{}{}
			<-ctx.Done()
			return ctx.Err()
		},
	}
	state := func() clickhouse.BatchAdmissionSnapshot {
		snapshot := emptyCurrentWorkerState()
		snapshot.Completed[head.ID] = digest
		return snapshot
	}
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{head}, nil },
		history: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{history, next, head}, nil
		},
		states:    func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) { return state(), nil },
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) { return state(), nil },
		admit:     func(context.Context, bool) error { return nil },
		wait:      func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
		ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			if imports.Add(1) != 1 || batch.ID != history.ID {
				return ingestion.Receipt{}, errors.New("unexpected additional import")
			}
			close(started)
			select {
			case <-ctx.Done():
				return ingestion.Receipt{}, ctx.Err()
			case <-release:
				return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
			}
		},
	}
	type outcome struct {
		summary Summary
		err     error
	}
	done := make(chan outcome, 1)
	go func() {
		summary, err := runCurrentWorkers(ctx, Config{
			WorkerCount: 2, MinimumStartLedger: 1, Drain: drain, HistoryAdmissionHold: hold,
		}, io)
		done <- outcome{summary, err}
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("first historical import was not admitted")
	}
	held.Store(true)
	close(release)
	select {
	case <-waiting:
	case <-ctx.Done():
		t.Fatal("next history admission did not wait after admitted import finished")
	}
	close(drain)
	select {
	case got := <-done:
		if got.err != nil || got.summary.IngestedBatches != 1 || got.summary.FailedBatches != 0 || imports.Load() != 1 {
			t.Fatalf("summary=%+v err=%v imports=%d", got.summary, got.err, imports.Load())
		}
	case <-ctx.Done():
		t.Fatal("drain did not cancel the hold wait")
	}
	if ctx.Err() != nil {
		t.Fatal("history hold or drain canceled the parent import context")
	}
}

func TestHistoryHoldRechecksAdmissionAndReleasesSelection(t *testing.T) {
	for _, phase := range []string{"pressure", "capacity"} {
		t.Run(phase, func(t *testing.T) {
			const digest = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
			history := currentWorkerTestBatch("77777777-7777-4777-8777-777777777777", 100, 163, digest)
			head := currentWorkerTestBatch("88888888-8888-4888-8888-888888888888", 9_937, 10_000, digest)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			var held, raised atomic.Bool
			var waits, historyReads, historyStates, imports atomic.Int32
			waiting := make(chan struct{}, 2)
			removed := make(chan struct{})
			hold := &HistoryAdmissionHold{
				MarkerPath: "/operator/history-hold",
				probe: func(string) string {
					if held.Load() {
						return "marker present"
					}
					return ""
				},
				wait: func(ctx context.Context) error {
					call := waits.Add(1)
					waiting <- struct{}{}
					if call == 1 {
						select {
						case <-removed:
							return nil
						case <-ctx.Done():
							return ctx.Err()
						}
					}
					<-ctx.Done()
					return ctx.Err()
				},
			}
			raise := func() {
				if raised.CompareAndSwap(false, true) {
					held.Store(true)
				}
			}
			state := func() clickhouse.BatchAdmissionSnapshot {
				snapshot := emptyCurrentWorkerState()
				snapshot.Completed[head.ID] = digest
				return snapshot
			}
			io := currentWorkerIO{
				recent: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{head}, nil },
				history: func(context.Context) ([]catalog.Batch, error) {
					historyReads.Add(1)
					return []catalog.Batch{history, head}, nil
				},
				states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
					for _, id := range ids {
						if id == history.ID {
							historyStates.Add(1)
						}
					}
					return state(), nil
				},
				allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) { return state(), nil },
				admit: func(_ context.Context, current bool) error {
					if !current && phase == "pressure" {
						raise()
					}
					return nil
				},
				capacity: func(context.Context) error {
					if phase == "capacity" {
						raise()
					}
					return nil
				},
				wait: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
				ingest: func(_ context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
					if batch.ID != history.ID || imports.Add(1) != 1 {
						return ingestion.Receipt{}, errors.New("released historical boundary was not retried once")
					}
					held.Store(true)
					return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
				},
			}
			done := make(chan error, 1)
			go func() {
				_, err := runCurrentWorkers(ctx, Config{WorkerCount: 2, MinimumStartLedger: 1, HistoryAdmissionHold: hold}, io)
				done <- err
			}()
			select {
			case <-waiting:
			case <-ctx.Done():
				t.Fatal("hold raised during admission did not defer history")
			}
			if imports.Load() != 0 {
				t.Fatal("held selection reached ingestion")
			}
			if phase == "pressure" && (historyReads.Load() != 0 || historyStates.Load() != 0) {
				t.Fatal("hold raised during pressure admission reached catalog/state selection")
			}
			held.Store(false)
			close(removed)
			select {
			case <-waiting:
			case <-ctx.Done():
				t.Fatal("released selection did not ingest and return to the hold")
			}
			if imports.Load() != 1 {
				t.Fatalf("historical imports after marker removal = %d, want one", imports.Load())
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("worker cancellation = %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("cancel did not release the hold wait")
			}
		})
	}
}
