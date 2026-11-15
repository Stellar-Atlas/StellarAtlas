package app

import (
	"fmt"
	"math"
)

const (
	currentBulkMaxLedgers     = 128
	currentBulkMaxOutputBytes = 8 << 30
	currentBulkSourceCushion  = 32 << 30
	currentBulkMetadataBudget = 16 << 20
)

func currentBulkSourceHeadroom(blockSize int64, blocks, freeBlocks, availableBlocks uint64) (available, required uint64, err error) {
	if blockSize <= 0 || blocks == 0 || availableBlocks > freeBlocks || freeBlocks > blocks || blocks > math.MaxUint64/uint64(blockSize) {
		return 0, 0, fmt.Errorf("invalid source filesystem capacity counters")
	}
	// The fixed HDD emergency allowance is independent of filesystem size and
	// NVMe reserves. Keep the bounded source-copy and metadata budgets additive.
	required = uint64(50_000_000_000) + currentBulkSourceCushion + currentBulkMaxOutputBytes + currentBulkMetadataBudget
	return availableBlocks * uint64(blockSize), required, nil
}
