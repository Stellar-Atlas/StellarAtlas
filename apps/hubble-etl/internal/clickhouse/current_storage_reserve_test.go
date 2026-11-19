package clickhouse

import (
	"context"
	"testing"
)

func TestCurrentPublicationStartUsesOnlyFixedEmergencyAllowance(t *testing.T) {
	const expected = uint64(50_000_000_000)
	for _, total := range []uint64{64_000_000_000_000, 100 << 40, ^uint64(0)} {
		got, err := currentPublicationStartBytes(total, 0)
		if err != nil || got != expected {
			t.Fatalf("total %d: got %d, %v; want %d", total, got, err, expected)
		}
	}
}

func TestCurrentPublicationStartRejectsInvalidCapacityOrPercentageReserve(t *testing.T) {
	for _, tc := range []struct {
		total uint64
		bps   uint32
	}{{0, 0}, {1, 1}, {64_000_000_000_000, 500}, {1, 10_001}, {^uint64(0), 10_000}} {
		if _, err := currentPublicationStartBytes(tc.total, tc.bps); err == nil {
			t.Fatalf("invalid capacity accepted: %+v", tc)
		}
	}
}

func TestCurrentPublicationRequiredBytesUsesProspectiveRequest(t *testing.T) {
	budgeted := context.WithValue(context.Background(), currentWriteBudgetKey{}, &currentWriteBudget{})
	for _, payload := range []uint64{64 << 10, 256 << 20} {
		ctx, err := withCurrentRequestExposure(budgeted, payload, 0, false)
		if err != nil {
			t.Fatal(err)
		}
		got, err := currentPublicationRequiredBytes(ctx, 64_000_000_000_000, 0)
		want := uint64(50_000_000_000) + 2*(payload+currentWriteOverhead)
		if err != nil || got != want {
			t.Fatalf("payload %d: got %d, %v; want %d", payload, got, err, want)
		}
	}
	if got, err := currentPublicationRequiredBytes(context.Background(), 1, 0); err != nil || got != 50_000_000_000 {
		t.Fatalf("unbudgeted preflight = %d, %v", got, err)
	}
	if _, err := currentPublicationRequiredBytes(budgeted, 1, 0); err == nil {
		t.Fatal("budgeted request without exposure was accepted")
	}
	unbudgeted, err := withCurrentRequestExposure(context.Background(), 1, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := currentPublicationRequiredBytes(unbudgeted, 1, 0); err == nil {
		t.Fatal("exposure without a write budget was accepted")
	}
	for _, invalid := range []uint64{0, currentRequestMaximumLogicalBytes + 1} {
		ctx := context.WithValue(budgeted, currentRequestExposureKey{}, currentRequestExposure{logicalBytes: invalid})
		if _, err := currentPublicationRequiredBytes(ctx, 1, 0); err == nil {
			t.Fatalf("invalid request exposure %d was accepted", invalid)
		}
	}
}

func TestCurrentPublicationUnrelatedReservationsRemainUnavailable(t *testing.T) {
	capacity := bulkFilesystemCapacity{device: 7, total: 64_000_000_000_000, available: 150_000_000_000}
	available, err := historicalUnreservedBytes(capacity, capacity, capacity, 150_000_000_000, 51_000_000_000)
	if err != nil || available != 51_000_000_000 {
		t.Fatalf("unrelated reservation was not subtracted once: %d, %v", available, err)
	}
	ctx := context.WithValue(context.Background(), currentWriteBudgetKey{}, &currentWriteBudget{})
	ctx, err = withCurrentRequestExposure(ctx, 1<<30, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	required, err := currentPublicationRequiredBytes(ctx, capacity.total, 0)
	if err != nil || available >= required {
		t.Fatalf("reserved space incorrectly admits this request: available %d, required %d, %v", available, required, err)
	}
}
