package clickhouse

import (
	"context"
	"errors"
	"testing"
)

// Accounting assertions settle their synthetic admission explicitly. Actual
// HTTP overlap and full-response settlement are exercised in the client tests.
func budgetAccountingAdmitConfirmed(ctx context.Context, query string, bodyLen int) error {
	settle, err := admitCurrentWrite(ctx, "`test`", query, bodyLen)
	if err == nil && settle != nil {
		settle(true)
	}
	return err
}

func TestCurrentWriteBudgetAccountingDoesNotOvercommit(t *testing.T) {
	ctx, err := WithCurrentWriteBudget(t.Context(), currentWriteStatusReserve+(16<<10), func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	const query = "INSERT INTO `test`.`history_ledgers` FORMAT Native"
	for range 2 {
		if err := budgetAccountingAdmitConfirmed(ctx, query, 4096); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := budgetAccountingAdmitConfirmed(ctx, query, 4096); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
			t.Fatalf("data quota was overcommitted: %v", err)
		}
	}
	for range currentWriteIndexStatusCount {
		const index = "INSERT INTO `test`._asset_holder_index_batches SETTINGS async_insert=0 FORMAT JSONEachRow"
		if err := budgetAccountingAdmitConfirmed(ctx, index, 4096); err != nil {
			t.Fatal(err)
		}
	}
	for range currentWriteStatusCount {
		if err := budgetAccountingAdmitConfirmed(ctx, "INSERT INTO `test`._ingestion_batches SETTINGS async_insert=0 FORMAT JSONEachRow", 4096); err != nil {
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
	if err := budgetAccountingAdmitConfirmed(ctx, query, 12<<10); !errors.Is(err, capacity) {
		t.Fatalf("capacity refusal not preserved: %v", err)
	}
	allowed = true
	if err := budgetAccountingAdmitConfirmed(ctx, query, 12<<10); err != nil {
		t.Fatal(err)
	}
	if err := budgetAccountingAdmitConfirmed(ctx, query, 1); !errors.Is(err, ErrCurrentWriteBudgetExceeded) {
		t.Fatalf("submitted charge was refunded: %v", err)
	}
}
