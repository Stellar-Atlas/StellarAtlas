package clickhouse

import (
	"errors"
	"math"
	"strings"
	"testing"
)

// The alias may stand in only for the exact disk path reported by ClickHouse.
func TestHistoryStorageMetadataBindingRejectsReportedPathDrift(t *testing.T) {
	policy := HistoricalStoragePolicy{
		ClickHouseReportedPath: "/bulk/warehouse", ClickHouseMetadataPath: "/run/private/warehouse", ClickHouseMetadataInode: 42,
	}
	for _, reported := range []string{"/bulk/warehouse", "/bulk/warehouse/"} {
		if got, err := policy.clickHouseCapacityPath(reported); err != nil || got != "/run/private/warehouse" {
			t.Errorf("exact metadata binding refused for %q: path=%q, error=%v", reported, got, err)
		}
	}
	for _, reported := range []string{
		"/bulk/other",
		"/bulk/./warehouse",
		"/bulk//warehouse",
		"/bulk/warehouse//",
		"/bulk/link/../warehouse",
	} {
		if _, err := policy.clickHouseCapacityPath(reported); err == nil {
			t.Errorf("non-exact reported directory %q was accepted", reported)
		}
	}
}

func TestHistoryStorageBudgetsBothSlotsAndProtectsSourceReserve(t *testing.T) {
	const GiB = uint64(1) << 30
	policy := HistoricalStoragePolicy{
		BulkRoot: t.TempDir(), SourceMinimumFreeBytes: 50_000_000_000,
		SourceMinimumFreeBasisPoints: 0, SourceCycleOutputBytes: 8 * GiB,
		CurrentWarehouseMarginBytes: 64 * GiB, UnreservedGrowthPerHistorySlotBytes: 32 * GiB,
	}
	for _, tc := range []struct{ total, want uint64 }{
		{64_000_000_000_000, 196_028_888_064},
		{100 * 1024 * GiB, 196_028_888_064},
		{math.MaxUint64, 196_028_888_064},
	} {
		got, err := policy.requiredBytes(tc.total, 2)
		if err != nil || got != tc.want {
			t.Fatalf("required=%d, want=%d, error=%v", got, tc.want, err)
		}
	}
	for _, slots := range []int{1, 3} {
		want := uint64(50_000_000_000) + (8+64+uint64(slots)*32)*GiB
		if got, err := policy.requiredBytes(64_000_000_000_000, slots); err != nil || got != want {
			t.Fatalf("history slots %d: required=%d, want=%d, error=%v", slots, got, want, err)
		}
	}
	for _, tc := range []struct {
		total uint64
		slots int
	}{{0, 2}, {64_000_000_000_000, 0}, {64_000_000_000_000, 4}} {
		if _, err := policy.requiredBytes(tc.total, tc.slots); err == nil {
			t.Fatalf("invalid capacity or slot count accepted: %+v", tc)
		}
	}
	policy.UnreservedGrowthPerHistorySlotBytes = math.MaxUint64
	if _, err := policy.requiredBytes(60*1024*GiB, 2); err == nil {
		t.Fatal("overflow was not rejected")
	}
	policy.UnreservedGrowthPerHistorySlotBytes = 32 * GiB
	policy.SourceCycleOutputBytes = math.MaxUint64
	if _, err := policy.requiredBytes(60*1024*GiB, 2); err == nil {
		t.Fatal("source allowance overflow was not rejected")
	}
	policy.SourceCycleOutputBytes = 8 * GiB
	policy.CurrentWarehouseMarginBytes = math.MaxUint64
	if _, err := policy.requiredBytes(60*1024*GiB, 2); err == nil {
		t.Fatal("warehouse allowance overflow was not rejected")
	}
}

func TestHistoryStoragePolicyRequiresFixedEmergencyAllowance(t *testing.T) {
	policy := HistoricalStoragePolicy{
		BulkRoot: t.TempDir(), SourceMinimumFreeBytes: 50_000_000_000,
		SourceCycleOutputBytes: 8 << 30, CurrentWarehouseMarginBytes: 64 << 30,
		UnreservedGrowthPerHistorySlotBytes: 32 << 30,
	}
	if err := policy.Validate(); err != nil {
		t.Fatalf("fixed base with zero percentage rejected: %v", err)
	}
	for _, tc := range []struct {
		bytes uint64
		bps   uint32
	}{{4 << 40, 500}, {4 << 40, 0}, {50_000_000_000, 500}, {0, 0}} {
		policy.SourceMinimumFreeBytes, policy.SourceMinimumFreeBasisPoints = tc.bytes, tc.bps
		if err := policy.Validate(); err == nil || !strings.Contains(err.Error(), "sourceMinimumFreeBytes=50000000000 and sourceMinimumFreeBasisPoints=0") {
			t.Fatalf("stale reserve did not receive an explicit diagnostic: %+v, %v", tc, err)
		}
	}
}

func TestHistoryStorageUsesSameDeviceAndSubtractsReservationsOnce(t *testing.T) {
	before := bulkFilesystemCapacity{device: 5, total: 1000, available: 970}
	after := bulkFilesystemCapacity{device: 5, total: 1000, available: 910}
	clickhousePath := bulkFilesystemCapacity{device: 5, total: 1000, available: 925}
	available, err := historicalUnreservedBytes(before, after, clickhousePath, 950, 850)
	if err != nil || available != 810 {
		t.Fatalf("available=%d, want=810, error=%v", available, err)
	}
	if got, err := historicalUnreservedBytes(before, after, clickhousePath, 950, 951); got != 0 ||
		!CurrentWriteCapacityDeferred(err) || !strings.Contains(err.Error(), "unreserved space exceeds free space") {
		t.Fatalf("conflicting accounting did not fail closed with a retryable diagnostic: %d, %v", got, err)
	}
	clickhousePath.device++
	if got, err := historicalUnreservedBytes(before, after, clickhousePath, 950, 850); got != 0 ||
		!CurrentWriteCapacityDeferred(err) || !strings.Contains(err.Error(), "devices disagree") {
		t.Fatalf("wrong device did not fail closed with its own diagnostic: %d, %v", got, err)
	}
	if CurrentWriteCapacityDeferred(errors.New("wrong pinned warehouse metadata path")) || CurrentWriteCapacityDeferred(nil) {
		t.Fatal("non-capacity outcomes were classified as retryable")
	}
}
