package clickhouse

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

func TestCurrentWriteBudgetAccountingDoesNotOvercommit(t *testing.T) {
	var passed atomic.Int32
	var wait sync.WaitGroup
	ctx, err := WithCurrentWriteBudget(t.Context(), currentWriteStatusReserve+(16<<10), func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for range 4 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			const query = "INSERT INTO `test`.`history_ledgers` FORMAT Native"
			err := admitCurrentWrite(ctx, "`test`", query, 4096)
			if err == nil {
				passed.Add(1)
			} else if !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
				t.Errorf("unexpected refusal: %v", err)
			}
		}()
	}
	wait.Wait()
	if passed.Load() != 2 {
		t.Fatalf("admitted %d requests, wanted two", passed.Load())
	}
	for range currentWriteIndexStatusCount {
		const index = "INSERT INTO `test`._asset_holder_index_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
		if err := admitCurrentWrite(ctx, "`test`", index, 4096); err != nil {
			t.Fatal(err)
		}
	}
	for range 3 {
		if err := admitCurrentWrite(ctx, "`test`", "INSERT INTO `test`._ingestion_batches SETTINGS async_insert=0 FORMAT JSONEachRow", 4096); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCurrentWriteBudgetAccountingNoChargeUntilCapacityPasses(t *testing.T) {
	capacity := errors.New("low space")
	allowed := false
	ctx, err := WithCurrentWriteBudget(t.Context(), currentWriteStatusReserve+(16<<10), func(context.Context) error {
		if !allowed {
			return capacity
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	const query = "INSERT INTO `test`.`history_ledgers` FORMAT JSONEachRow"
	if err := admitCurrentWrite(ctx, "`test`", query, 12<<10); !errors.Is(err, capacity) {
		t.Fatalf("capacity refusal not preserved: %v", err)
	}
	allowed = true
	if err := admitCurrentWrite(ctx, "`test`", query, 12<<10); err != nil {
		t.Fatal(err)
	}
	if err := admitCurrentWrite(ctx, "`test`", query, 1); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("submitted charge was refunded: %v", err)
	}
}
