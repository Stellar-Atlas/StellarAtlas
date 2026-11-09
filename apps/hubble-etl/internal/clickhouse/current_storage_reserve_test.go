package clickhouse

import "testing"

func TestCurrentPublicationStartKeepsFivePercentAndExplicitRunway(t *testing.T) {
	const total = uint64(64_000_911_998_976)
	const expected = uint64(3_311_714_749_645)
	for _, bps := range []uint32{0, 472, 499, 500} {
		got, err := currentPublicationStartBytes(total, bps)
		if err != nil || got != expected {
			t.Fatalf("basis points %d: got %d, %v; want %d", bps, got, err, expected)
		}
	}
	higher, err := currentPublicationStartBytes(total, 600)
	if err != nil || higher <= expected {
		t.Fatalf("higher configured floor ignored: %d, %v", higher, err)
	}
}

func TestCurrentPublicationStartRejectsInvalidOrOverflowingCapacity(t *testing.T) {
	for _, tc := range []struct {
		total uint64
		bps   uint32
	}{{0, 500}, {1, 10_001}, {^uint64(0), 10_000}} {
		if _, err := currentPublicationStartBytes(tc.total, tc.bps); err == nil {
			t.Fatalf("invalid capacity accepted: %+v", tc)
		}
	}
}
