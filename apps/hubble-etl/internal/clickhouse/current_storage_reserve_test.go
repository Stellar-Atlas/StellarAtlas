package clickhouse

import "testing"

func TestCurrentPublicationStartUsesFixedEmergencyAllowanceAndExplicitRunway(t *testing.T) {
	const expected = uint64(127_309_411_328)
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
