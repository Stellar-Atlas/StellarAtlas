package app

import (
	"math"
	"testing"
)

func TestCurrentBulkSourceHeadroom(t *testing.T) {
	const fixedBytes = (40 << 30) + (16 << 20)
	tests := []struct {
		name                            string
		blockSize                       int64
		blocks, freeBlocks, availBlocks uint64
		wantAvailable, wantRequired     uint64
	}{
		{"known layout", 4096, 1<<30 + 1, 1 << 27, 1 << 26, 1 << 38, 219902325760 + fixedBytes},
		{"zero unprivileged availability", 4096, 1 << 30, 1 << 27, 0, 0, 219902325556 + fixedBytes},
		{"largest capacity", 1, math.MaxUint64, math.MaxUint64, math.MaxUint64, math.MaxUint64, 922337203685477581 + fixedBytes},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			available, required, err := currentBulkSourceHeadroom(tt.blockSize, tt.blocks, tt.freeBlocks, tt.availBlocks)
			if err != nil || available != tt.wantAvailable || required != tt.wantRequired {
				t.Fatalf("got (%d, %d, %v), want (%d, %d, nil)", available, required, err, tt.wantAvailable, tt.wantRequired)
			}
		})
	}
}

func TestCurrentBulkSourceHeadroomRejectsMalformedCounters(t *testing.T) {
	tests := []struct {
		name                            string
		blockSize                       int64
		blocks, freeBlocks, availBlocks uint64
	}{
		{"zero block size", 0, 1, 0, 0},
		{"negative block size", -1, 1, 0, 0},
		{"zero blocks", 4096, 0, 0, 0},
		{"free exceeds total", 4096, 2, 3, 1},
		{"available exceeds free", 4096, 3, 1, 2},
		{"total overflows", 4096, math.MaxUint64/4096 + 1, 1, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := currentBulkSourceHeadroom(tt.blockSize, tt.blocks, tt.freeBlocks, tt.availBlocks); err == nil {
				t.Fatal("expected malformed counters to be rejected")
			}
		})
	}
}
