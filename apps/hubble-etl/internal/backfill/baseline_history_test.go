package backfill

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

func TestBaselineHistoryAdmissionPreservesReservedCurrentAndDrain(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(fmt.Sprintf("baseline=%t", enabled), func(t *testing.T) {
			const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			current := currentWorkerTestBatch("11111111-1111-4111-8111-111111111111", 9937, 10000, digest)
			history := currentWorkerTestBatch("22222222-2222-4222-8222-222222222222", 100, 163, digest)
			extra := currentWorkerTestBatch("33333333-3333-4333-8333-333333333333", 164, 227, digest)
			read := func(path string) ([]byte, error) {
				if strings.HasSuffix(path, "inflight") {
					return []byte("2000 2000"), nil
				}
				return []byte("some avg10=35\nfull avg10=25"), nil
			}
			strictBlocked := make(chan struct{}, 2)
			strictStopped := make(chan struct{}, 2)
			strict := &PressureGuard{
				MaximumFullBasisPoints: 2000, MaximumSomeBasisPoints: 3000,
				MaximumInflight: 256, read: read,
				wait: func(ctx context.Context) error {
					strictBlocked <- struct{}{}
					<-ctx.Done()
					strictStopped <- struct{}{}
					return ctx.Err()
				},
			}
			baseline := &PressureGuard{MaximumFullBasisPoints: 3000, MaximumSomeBasisPoints: 4000, SkipInflightLimit: true, read: read}
			currentGuard := &PressureGuard{MaximumFullBasisPoints: 4000, MaximumSomeBasisPoints: 5000, SkipInflightLimit: true, read: read}
			var baselineCalls atomic.Int32
			var capacityCalls atomic.Int32
			started := make(chan string, 3)
			release := make(chan struct{})
			drain := make(chan struct{})
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			config := Config{WorkerCount: 3, PressureGuard: strict, Drain: drain}
			if enabled {
				config.BaselineHistoryPressureGuard = baseline
			}
			io := currentWorkerIO{
				recent:  func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{current}, nil },
				history: func(context.Context) ([]catalog.Batch, error) { return []catalog.Batch{history, extra, current}, nil },
				states: func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error) {
					return emptyCurrentWorkerState(), nil
				},
				allStates: func(context.Context) (clickhouse.BatchAdmissionSnapshot, error) {
					return emptyCurrentWorkerState(), nil
				},
				admit: func(ctx context.Context, current bool) error {
					if current {
						return currentGuard.Wait(ctx)
					}
					return strict.Wait(ctx)
				},
				// Even when installed in the fixture, nil config must not use it.
				baselineAdmit: func(ctx context.Context) error {
					baselineCalls.Add(1)
					return baseline.Wait(ctx)
				},
				capacity: func(context.Context) error { capacityCalls.Add(1); return nil },
				ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
					started <- batch.ID
					select {
					case <-release:
						if err := ctx.Err(); err != nil {
							return ingestion.Receipt{}, fmt.Errorf("drain cancelled admitted import: %w", err)
						}
						return ingestion.Receipt{LedgerCount: batch.LedgerCount, RowCount: 1}, nil
					case <-ctx.Done():
						return ingestion.Receipt{}, ctx.Err()
					}
				},
				wait: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
			}
			type outcome struct {
				summary Summary
				err     error
			}
			done := make(chan outcome, 1)
			go func() {
				summary, err := runCurrentWorkers(ctx, config, io)
				done <- outcome{summary, err}
			}()
			wantStarted, wantBlocked := 1, 2
			if enabled {
				wantStarted, wantBlocked = 2, 1
			}
			seen := make(map[string]bool)
			for range wantStarted {
				select {
				case id := <-started:
					if seen[id] {
						t.Fatalf("duplicate admitted batch %s", id)
					}
					seen[id] = true
				case <-ctx.Done():
					t.Fatal("eligible imports did not start")
				}
			}
			for range wantBlocked {
				select {
				case <-strictBlocked:
				case <-ctx.Done():
					t.Fatal("strict historical admission was not blocked")
				}
			}
			if !seen[current.ID] || seen[extra.ID] || seen[history.ID] != enabled {
				t.Fatalf("admitted batches = %v; baseline must retain history selection", seen)
			}
			close(drain)
			for range wantBlocked {
				select {
				case <-strictStopped:
				case <-ctx.Done():
					t.Fatal("drain did not stop blocked admission")
				}
			}
			select {
			case <-done:
				t.Fatal("drain did not wait for admitted imports")
			default:
			}
			close(release)
			select {
			case result := <-done:
				if result.err != nil || result.summary.FailedBatches != 0 || result.summary.IngestedBatches != wantStarted {
					t.Fatalf("drained result = %+v, %v", result.summary, result.err)
				}
			case <-ctx.Done():
				t.Fatal("admitted imports did not finish after drain")
			}
			wantBaseline := int32(0)
			if enabled {
				wantBaseline = 1
			}
			if got := baselineCalls.Load(); got != wantBaseline {
				t.Fatalf("baseline admissions = %d, want %d", got, wantBaseline)
			}
			if got := capacityCalls.Load(); got != int32(wantStarted) {
				t.Fatalf("fresh capacity checks = %d, want %d", got, wantStarted)
			}
			select {
			case id := <-started:
				t.Fatalf("extra import admitted: %s", id)
			default:
			}
		})
	}
}
