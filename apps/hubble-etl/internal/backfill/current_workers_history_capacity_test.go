package backfill

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestHistoryCapacityDefersAndResumesSameBatchWithoutBlockingCurrent(t *testing.T) {
	const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	historyBatch := currentWorkerTestBatch("11111111-1111-4111-8111-111111111111", 100, 163, digest)
	currentBatch := currentWorkerTestBatch("22222222-2222-4222-8222-222222222222", 9_937, 10_000, digest)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	deferred := make(chan struct{})
	blockedOnSecondCheck := make(chan struct{})
	resumeHistory := make(chan struct{})
	historyIngested := make(chan string, 1)
	currentIngested := make(chan string, 1)
	var historyChecks atomic.Int32
	var mu sync.Mutex
	completed := make(map[string]string)

	snapshot := func(ids []string) clickhouse.BatchAdmissionSnapshot {
		mu.Lock()
		defer mu.Unlock()
		state := emptyCurrentWorkerState()
		for _, id := range ids {
			if digest, ok := completed[id]; ok {
				state.Completed[id] = digest
			}
		}
		return state
	}
	io := currentWorkerIO{
		recent: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{currentBatch}, nil
		},
		history: func(context.Context) ([]catalog.Batch, error) {
			return []catalog.Batch{historyBatch, currentBatch}, nil
		},
		states: func(_ context.Context, ids []string) (clickhouse.BatchAdmissionSnapshot, error) {
			return snapshot(ids), nil
		},
		allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
			mu.Lock()
			defer mu.Unlock()
			state := emptyCurrentWorkerState()
			for id, digest := range completed {
				state.Completed[id] = digest
			}
			return state, nil
		},
		admit:    func(context.Context, bool) error { return nil },
		capacity: func(context.Context) error { return nil },
		historyCapacity: func(ctx context.Context) error {
			switch historyChecks.Add(1) {
			case 1:
				close(deferred)
				return errors.New("temporary history reserve refusal")
			case 2:
				close(blockedOnSecondCheck)
				select {
				case <-resumeHistory:
					return nil
				case <-ctx.Done():
					return ctx.Err()
				}
			default:
				return nil
			}
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
		ingest: func(_ context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			mu.Lock()
			completed[batch.ID] = batch.SourceSHA256
			mu.Unlock()
			if batch.ID == historyBatch.ID {
				historyIngested <- batch.ID
			} else {
				currentIngested <- batch.ID
			}
			return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
		},
	}

	done := make(chan error, 1)
	go func() {
		_, err := runCurrentWorkers(ctx, Config{WorkerCount: 2, MinimumStartLedger: 1}, io)
		done <- err
	}()

	select {
	case <-deferred:
	case <-ctx.Done():
		t.Fatal("history capacity did not defer the first admission")
	}
	select {
	case <-blockedOnSecondCheck:
	case <-ctx.Done():
		t.Fatal("history capacity did not retry the selected batch")
	}
	select {
	case id := <-currentIngested:
		if id != currentBatch.ID {
			t.Fatalf("current batch=%s, want %s", id, currentBatch.ID)
		}
	case <-ctx.Done():
		t.Fatal("current batch did not finish while history capacity was blocked")
	}
	select {
	case id := <-historyIngested:
		t.Fatalf("history ingested %s before capacity resumed", id)
	default:
	}

	close(resumeHistory)
	select {
	case id := <-historyIngested:
		if id != historyBatch.ID {
			t.Fatalf("resumed history batch=%s, want same selected batch %s", id, historyBatch.ID)
		}
	case <-ctx.Done():
		t.Fatal("history batch did not resume after capacity recovered")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("runCurrentWorkers error=%v, want context cancellation", err)
		}
	case <-time.After(time.Second):
		t.Fatal("workers did not stop after cancellation")
	}
	if got := historyChecks.Load(); got < 2 {
		t.Fatalf("history capacity checks=%d, want at least two", got)
	}
}
