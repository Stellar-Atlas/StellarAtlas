package app

import (
	"fmt"
	"io/fs"
	"math"
	"path/filepath"
)

const (
	currentBulkMaxLedgers     = 128
	currentBulkMaxOutputBytes = 8 << 30
	currentBulkMetadataBudget = 16 << 20
)

func currentBulkSourceHeadroom(blockSize int64, blocks, freeBlocks, availableBlocks, publicationBytes uint64) (available, required uint64, err error) {
	if blockSize <= 0 || blocks == 0 || availableBlocks > freeBlocks || freeBlocks > blocks || blocks > math.MaxUint64/uint64(blockSize) {
		return 0, 0, fmt.Errorf("invalid source filesystem capacity counters")
	}
	// The stage is complete on a different filesystem. Reserve its actual copy
	// demand, not the output cap again or an unrelated fixed cushion. Existing
	// destination data is already reflected in availableBlocks.
	const floor = uint64(50_000_000_000) + currentBulkMetadataBudget
	if publicationBytes > math.MaxUint64-floor {
		return 0, 0, fmt.Errorf("publication copy size overflows capacity accounting")
	}
	required = floor + publicationBytes
	return availableBlocks * uint64(blockSize), required, nil
}

// currentBulkPublicationBytes measures the complete private stage without
// reading payloads. The copy is not sparse, so use logical file lengths rounded
// to destination allocation units rather than the source's allocated blocks.
func currentBulkPublicationBytes(stage string, allocationUnit uint64) (uint64, error) {
	if allocationUnit == 0 {
		return 0, fmt.Errorf("invalid destination allocation unit")
	}
	var total uint64
	err := filepath.WalkDir(stage, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		var size uint64
		switch {
		case info.IsDir():
			size = allocationUnit
		case info.Mode().IsRegular() && info.Size() >= 0:
			size = uint64(info.Size())
		default:
			return fmt.Errorf("publication stage contains unsupported entry %q", name)
		}
		if remainder := size % allocationUnit; remainder != 0 {
			padding := allocationUnit - remainder
			if size > math.MaxUint64-padding {
				return fmt.Errorf("publication entry size overflows capacity accounting")
			}
			size += padding
		}
		if total > math.MaxUint64-size {
			return fmt.Errorf("publication copy size overflows capacity accounting")
		}
		total += size
		return nil
	})
	return total, err
}
