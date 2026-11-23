package app

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestCurrentBulkSourceHeadroom(t *testing.T) {
	const fixedBytes = 50_000_000_000 + (16 << 20)
	tests := []struct {
		name                            string
		blockSize                       int64
		blocks, freeBlocks, availBlocks uint64
		publicationBytes                uint64
		wantAvailable, wantRequired     uint64
	}{
		{"known layout", 4096, 1<<30 + 1, 1 << 27, 1 << 26, 4096, 1 << 38, fixedBytes + 4096},
		{"no percentage or fixed cushion on large filesystem", 1, 64_000_000_000_000, 64_000_000_000_000, 64_000_000_000_000, 1 << 20, 64_000_000_000_000, fixedBytes + (1 << 20)},
		{"zero unprivileged availability", 4096, 1 << 30, 1 << 27, 0, 4096, 0, fixedBytes + 4096},
		{"largest capacity", 1, math.MaxUint64, math.MaxUint64, math.MaxUint64, 0, math.MaxUint64, fixedBytes},
		{"observed disk admits actual copy rather than cap", 1, 64_000_000_000_000, 85_332_951_040, 85_332_951_040, 64 << 20, 85_332_951_040, fixedBytes + (64 << 20)},
		{"full output still reserved when actually present", 4096, 1 << 30, 1 << 27, 1 << 26, 8 << 30, 1 << 38, fixedBytes + (8 << 30)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			available, required, err := currentBulkSourceHeadroom(tt.blockSize, tt.blocks, tt.freeBlocks, tt.availBlocks, tt.publicationBytes)
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
			if _, _, err := currentBulkSourceHeadroom(tt.blockSize, tt.blocks, tt.freeBlocks, tt.availBlocks, 0); err == nil {
				t.Fatal("expected malformed counters to be rejected")
			}
		})
	}
	if _, _, err := currentBulkSourceHeadroom(1, math.MaxUint64, math.MaxUint64, math.MaxUint64, math.MaxUint64); err == nil {
		t.Fatal("expected publication size overflow to be rejected")
	}
}

func TestCurrentBulkPublicationBytes(t *testing.T) {
	stage := t.TempDir()
	nested := filepath.Join(stage, "nested")
	if err := os.Mkdir(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, contents := range map[string][]byte{
		"manifest.json":       []byte("{}"),
		"nested/data.parquet": make([]byte, 4097),
		"nested/empty":        nil,
	} {
		if err := os.WriteFile(filepath.Join(stage, filepath.FromSlash(name)), contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Two directory blocks, one manifest block, two data blocks, no data for
	// the empty file. Metadata headroom is reserved separately by the caller.
	bytes, err := currentBulkPublicationBytes(stage, 4096)
	if err != nil || bytes != 5*4096 {
		t.Fatalf("got (%d, %v), want (%d, nil)", bytes, err, 5*4096)
	}
	if _, err := currentBulkPublicationBytes(stage, 0); err == nil {
		t.Fatal("expected zero allocation unit rejection")
	}
	if _, err := currentBulkPublicationBytes(filepath.Join(stage, "missing"), 4096); err == nil {
		t.Fatal("expected missing stage rejection")
	}
}

func TestCurrentBulkPublicationBytesRejectsSymlink(t *testing.T) {
	stage := t.TempDir()
	if err := os.Symlink(t.TempDir(), filepath.Join(stage, "outside")); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if _, err := currentBulkPublicationBytes(stage, 4096); err == nil {
		t.Fatal("expected symlink rejection")
	}
}
