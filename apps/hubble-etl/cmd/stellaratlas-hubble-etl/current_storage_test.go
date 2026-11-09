package main

import (
	"path/filepath"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestCurrentWriteBudgetIsScopedToReservedCurrentPublisher(t *testing.T) {
	root := t.TempDir()
	policy := &clickhouse.HistoricalStoragePolicy{
		BulkRoot: root, SourceMinimumFreeBytes: 1, SourceMinimumFreeBasisPoints: 500,
		SourceCycleOutputBytes: 8 << 30, CurrentWarehouseMarginBytes: 64 << 30,
		UnreservedGrowthPerHistorySlotBytes: 1, ClickHouseMetadataInode: 1,
		ClickHouseMetadataPath: filepath.Join(root, "meta"),
		ClickHouseReportedPath: filepath.Join(root, "warehouse"),
	}
	t.Setenv(currentWriteBudgetEnv, "34359738368")
	t.Setenv(currentWriteMinimumEnv, "100")
	if got, minimum, err := loadCurrentWriteBudget(true, policy); got != 32<<30 || minimum != 100 || err != nil {
		t.Fatalf("guarded config rejected: %d, %v", got, err)
	}
	for _, tc := range []struct {
		reserved bool
		minimum  string
		policy   *clickhouse.HistoricalStoragePolicy
	}{{false, "100", policy}, {true, "0", policy}, {true, "100", nil}} {
		t.Setenv(currentWriteMinimumEnv, tc.minimum)
		if got, _, err := loadCurrentWriteBudget(tc.reserved, tc.policy); got != 0 || err == nil {
			t.Fatalf("unsafe config accepted: %+v: %d, %v", tc, got, err)
		}
	}
	t.Setenv(currentWriteBudgetEnv, "34359738369")
	if _, _, err := loadCurrentWriteBudget(true, policy); err == nil {
		t.Fatal("accepted payload budget above 32 GiB")
	}
}
