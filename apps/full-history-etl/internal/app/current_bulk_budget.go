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
	total := blocks * uint64(blockSize)
	// Round 5% up without overflowing even at MaxUint64 bytes.
	reserve := total / 20
	if total%20 != 0 {
		reserve++
	}
	required = reserve + currentBulkSourceCushion + currentBulkMaxOutputBytes + currentBulkMetadataBudget
	return availableBlocks * uint64(blockSize), required, nil
}
