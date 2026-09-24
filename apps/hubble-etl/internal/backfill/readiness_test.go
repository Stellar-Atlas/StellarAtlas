package backfill

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestReadinessSingleFlightAndHealthyCache(t *testing.T) {
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	guard := &WarehouseReadinessGuard{Probe: func(ctx context.Context) error {
		if calls.Add(1) == 1 {
			close(entered)
		}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	results := make(chan error, 12)
	for i := 0; i < cap(results); i++ {
		go func() { results <- guard.Wait(ctx) }()
	}
	<-entered
	close(release)
	for i := 0; i < cap(results); i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 20; i++ {
		if err := guard.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("healthy admission caused %d probes", calls.Load())
	}
	if guard.Invalidate(errors.New("invalid source XDR")) || guard.Invalidate(&clickhouse.RequestError{Err: context.Canceled}) {
		t.Fatal("source failure or normal shutdown invalidated warehouse readiness")
	}
	if err := guard.Wait(ctx); err != nil || calls.Load() != 1 {
		t.Fatalf("source failure invalidated cache: %v / %d", err, calls.Load())
	}
}

func TestReadinessAutomaticallyResumesAndReportsTransitions(t *testing.T) {
	var calls int
	var events []string
	guard := &WarehouseReadinessGuard{
		RetryAfter: time.Millisecond,
		Probe: func(context.Context) error {
			calls++
			if calls == 1 {
				return errors.New("ledger_transactions: ASYNC_LOAD_FAILED")
			}
			return nil
		},
		Log: func(event, reason string) { events = append(events, event) },
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := guard.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(events) != 2 || events[0] != "warehouse-unavailable" || events[1] != "warehouse-ready" {
		t.Fatalf("unexpected recovery: calls=%d events=%v", calls, events)
	}
}

func TestReadinessUnhealthyStopsBeforeCatalogAndBoundsBackoff(t *testing.T) {
	var calls int
	guard := &WarehouseReadinessGuard{
		RetryAfter: time.Hour,
		Probe:      func(context.Context) error { calls++; return errors.New("table unavailable") },
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	defer cancel()
	_, err := Cycle(ctx, Config{
		Client: &clickhouse.Client{}, WorkerCount: 2,
		DatabaseURL: "invalid-must-never-be-opened", ReadinessGuard: guard,
	})
	if !errors.Is(err, context.DeadlineExceeded) || calls != 1 {
		t.Fatalf("unhealthy admission reached catalog or repeated probes: %v / %d", err, calls)
	}
	guard.Invalidate(&clickhouse.RequestError{Err: errors.New("another in-flight insert failed")})
	ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Millisecond)
	defer cancel2()
	if err := guard.Wait(ctx2); !errors.Is(err, context.DeadlineExceeded) || calls != 1 {
		t.Fatalf("invalidation bypassed shared retry deadline: %v / %d", err, calls)
	}
}

func TestReadinessInvalidationFencesInflightProbe(t *testing.T) {
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	guard := &WarehouseReadinessGuard{Probe: func(context.Context) error {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		return nil
	}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- guard.Wait(ctx) }()
	<-entered
	guard.Invalidate(&clickhouse.RequestError{Err: errors.New("new failed table")})
	close(release)
	if err := <-result; err != nil || calls.Load() != 2 {
		t.Fatalf("stale successful probe erased failure: %v / %d", err, calls.Load())
	}
}

func TestReadinessProbeTimeoutIsBounded(t *testing.T) {
	var calls atomic.Int32
	guard := &WarehouseReadinessGuard{
		ProbeTimeout: time.Millisecond,
		RetryAfter:   time.Hour,
		Probe:        func(ctx context.Context) error { calls.Add(1); <-ctx.Done(); return ctx.Err() },
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	defer cancel()
	if err := guard.Wait(ctx); !errors.Is(err, context.DeadlineExceeded) || calls.Load() != 1 {
		t.Fatalf("probe/backoff did not honour deadline: %v / %d", err, calls.Load())
	}
}

func TestReadinessRecheckedAfterIOAdmission(t *testing.T) {
	var calls int
	guard := &WarehouseReadinessGuard{Probe: func(context.Context) error { calls++; return nil }}
	var once sync.Once
	pressure := &PressureGuard{read: func(path string) ([]byte, error) {
		once.Do(func() { guard.Invalidate(&clickhouse.RequestError{Err: errors.New("failure during I/O wait")}) })
		if path == "/proc/pressure/io" {
			return []byte("some avg10=0\nfull avg10=0\n"), nil
		}
		return []byte("0 0"), nil
	}}
	if err := waitBatchAdmission(context.Background(), Config{ReadinessGuard: guard, PressureGuard: pressure}); err != nil || calls != 2 {
		t.Fatalf("source admission skipped refreshed readiness: %v / %d", err, calls)
	}
}
