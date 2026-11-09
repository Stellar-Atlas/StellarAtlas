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

func TestHistoryStorageMetadataBindingRequiresAllExactFields(t *testing.T) {
	required := `{"bulkRoot":"/bulk","sourceMinimumFreeBytes":100,"sourceMinimumFreeBasisPoints":500,"sourceCycleOutputBytes":8,"currentWarehouseMarginBytes":32,"unreservedGrowthPerHistorySlotBytes":16,`
	binding := `"clickhouseReportedPath":"/bulk/warehouse","clickhouseMetadataPath":"/run/private/warehouse","clickhouseMetadataInode":42}`
	t.Setenv(historyStoragePolicyEnv, required+binding)
	policy, err := loadHistoryStoragePolicy(true)
	if err != nil || policy.ClickHouseMetadataInode != 42 {
		t.Fatalf("valid metadata binding was not parsed: policy=%v, error=%v", policy, err)
	}
	for _, invalid := range []string{
		strings.Replace(binding, `,"clickhouseMetadataInode":42`, "", 1),
		strings.Replace(binding, `"clickhouseMetadataInode":42`, `"clickhouseMetadataInode":null`, 1),
		strings.Replace(binding, `"clickhouseMetadataPath"`, `"ClickHouseMetadataPath"`, 1),
		strings.Replace(binding, `"clickhouseMetadataInode":42`, `"clickhouseMetadataInode":42,"clickhouseMetadataInode":43`, 1),
		strings.Replace(binding, "/run/private/warehouse", "/bulk/warehouse", 1),
	} {
		t.Setenv(historyStoragePolicyEnv, required+invalid)
		if _, err := loadHistoryStoragePolicy(true); err == nil {
			t.Fatal("an incomplete or ambiguous metadata binding was accepted")
		}
	}
}
