package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestHistoryStoragePolicyIsOptInAndRequiresReservedCurrent(t *testing.T) {
	t.Setenv(historyStoragePolicyEnv, "")
	if got, err := loadHistoryStoragePolicy(false); got != nil || err != nil {
		t.Fatalf("unconfigured policy changed existing defaults: policy=%v, error=%v", got, err)
	}
	want := clickhouse.HistoricalStoragePolicy{
		BulkRoot: t.TempDir(), SourceMinimumFreeBytes: 100, SourceMinimumFreeBasisPoints: 500,
		SourceCycleOutputBytes: 8, CurrentWarehouseMarginBytes: 32, UnreservedGrowthPerHistorySlotBytes: 16,
	}
	value, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(historyStoragePolicyEnv, string(value))
	if _, err := loadHistoryStoragePolicy(false); err == nil {
		t.Fatal("configured policy was accepted without a separate current lane")
	}
	if got, err := loadHistoryStoragePolicy(true); err != nil || got == nil || *got != want {
		t.Fatalf("configured policy not preserved: policy=%v, error=%v", got, err)
	}
	for _, invalid := range []string{
		"   ", string(value) + "{}", `{"sourceMinimumFreeBytes":1,` + string(value)[1:],
		strings.Replace(string(value), `"sourceMinimumFreeBytes"`, `"SourceMinimumFreeBytes"`, 1),
	} {
		t.Setenv(historyStoragePolicyEnv, invalid)
		if _, err := loadHistoryStoragePolicy(true); err == nil {
			t.Fatal("an ambiguous policy was accepted")
		}
	}
}
