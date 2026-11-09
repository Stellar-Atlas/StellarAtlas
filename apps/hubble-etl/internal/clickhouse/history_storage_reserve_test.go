package clickhouse

import (
	"math"
	"testing"
)

func TestHistoryStorageBudgetsBothSlotsAndProtectsSourceReserve(t *testing.T) {
	const GiB = uint64(1) << 30
	policy := HistoricalStoragePolicy{
		BulkRoot: t.TempDir(), SourceMinimumFreeBytes: 4 * 1024 * GiB,
		SourceMinimumFreeBasisPoints: 500, SourceCycleOutputBytes: 8 * GiB,
		CurrentWarehouseMarginBytes: 32 * GiB, UnreservedGrowthPerHistorySlotBytes: 12 * GiB,
	}
	for _, tc := range []struct{ total, want uint64 }{
		{60 * 1024 * GiB, (4*1024 + 8 + 32 + 2*12) * GiB},
		{100 * 1024 * GiB, (5*1024 + 8 + 32 + 2*12) * GiB},
	} {
		got, err := policy.requiredBytes(tc.total, 2)
		if err != nil || got != tc.want {
			t.Fatalf("required=%d, want=%d, error=%v", got, tc.want, err)
		}
	}
	policy.SourceMinimumFreeBytes = GiB
	if got, err := policy.requiredBytes(1000*GiB, 2); err != nil || got != (500+8+32+2*12)*GiB {
		t.Fatalf("history growth consumed the ordinary publisher reserve: required=%d, error=%v", got, err)
	}
	policy.UnreservedGrowthPerHistorySlotBytes = math.MaxUint64
	if _, err := policy.requiredBytes(60*1024*GiB, 2); err == nil {
		t.Fatal("overflow was not rejected")
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
	if _, err := historicalUnreservedBytes(before, after, clickhousePath, 950, 951); err == nil {
		t.Fatal("invalid reservation was not rejected")
	}
	clickhousePath.device++
	if _, err := historicalUnreservedBytes(before, after, clickhousePath, 950, 850); err == nil {
		t.Fatal("a different filesystem was not rejected")
	}
}
