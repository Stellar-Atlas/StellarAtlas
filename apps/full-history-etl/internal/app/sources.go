package app

import (
	"context"
	"encoding/hex"
	"fmt"

	batchinput "github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/input"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/transform"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type ShardEvidence struct {
	Range         ManifestRange
	SourceObjects []SourceEvidence
}

func inspectSources(ctx context.Context, config Config) (ShardEvidence, error) {
	return walkSources(ctx, config, nil)
}

func processSources(ctx context.Context, config Config, processor *transform.Processor) (ShardEvidence, error) {
	if processor == nil {
		return ShardEvidence{}, fmt.Errorf("processor is required")
	}
	return walkSources(ctx, config, processor)
}

func walkSources(ctx context.Context, config Config, processor *transform.Processor) (ShardEvidence, error) {
	evidence := ShardEvidence{
		Range:         ManifestRange{StartLedger: config.StartLedger, EndLedger: config.EndLedger},
		SourceObjects: make([]SourceEvidence, 0, len(config.Sources)),
	}
	nextLedger := uint64(config.StartLedger)
	var compressedBytes, xdrBytes int64
	var ledgerCount uint64
	var previousHash xdr.Hash
	hasPreviousHash := false

	for index, source := range config.Sources {
		if err := ctx.Err(); err != nil {
			return ShardEvidence{}, err
		}
		if nextLedger > uint64(config.EndLedger) {
			return ShardEvidence{}, fmt.Errorf("input %d (%s) begins after expected shard end %d", index, source.ObjectKey, config.EndLedger)
		}
		remainingCompressed := config.MaxCompressedBytes - compressedBytes
		remainingXDR := config.MaxUncompressedBytes - xdrBytes
		remainingLedgers := config.MaxLedgers - ledgerCount
		if remainingCompressed <= 0 || remainingXDR <= 0 || remainingLedgers == 0 {
			return ShardEvidence{}, fmt.Errorf("input %d (%s) exceeds aggregate shard limits", index, source.ObjectKey)
		}

		batch, err := batchinput.DecodeFile(source.Path, uint32(nextLedger), config.EndLedger, batchinput.Limits{
			MaxCompressedBytes:    remainingCompressed,
			MaxUncompressedBytes:  remainingXDR,
			MaxDecodedMemoryBytes: config.MaxDecodedMemoryBytes,
			MaxLedgers:            remainingLedgers,
		})
		if err != nil {
			return ShardEvidence{}, fmt.Errorf("decode input %d (%s): %w", index, source.ObjectKey, err)
		}
		if hasPreviousHash && batch.FirstPreviousHash != previousHash {
			batch.Close()
			return ShardEvidence{}, fmt.Errorf("input %d (%s) does not link to the preceding source object", index, source.ObjectKey)
		}
		if processor != nil {
			if err := processor.Process(ctx, batch, config.MaxDecodedMemoryBytes); err != nil {
				batch.Close()
				return ShardEvidence{}, fmt.Errorf("process input %d (%s): %w", index, source.ObjectKey, err)
			}
		}

		evidence.SourceObjects = append(evidence.SourceObjects, SourceEvidence{
			ObjectKey:               source.ObjectKey,
			StartLedger:             batch.Start,
			EndLedger:               batch.End,
			LedgerCount:             batch.LedgerCount,
			CompressedByteCount:     batch.CompressedBytes,
			CompressedSHA256:        batch.CompressedSHA256,
			FirstPreviousLedgerHash: hex.EncodeToString(batch.FirstPreviousHash[:]),
			LastLedgerHash:          hex.EncodeToString(batch.LastLedgerHash[:]),
			XDRByteCount:            batch.UncompressedBytes,
			XDRSHA256:               batch.XDRSHA256,
		})
		compressedBytes += batch.CompressedBytes
		xdrBytes += batch.UncompressedBytes
		ledgerCount += batch.LedgerCount
		nextLedger = uint64(batch.End) + 1
		previousHash = batch.LastLedgerHash
		hasPreviousHash = true
		batch.Close()
	}

	expectedNext := uint64(config.EndLedger) + 1
	if nextLedger != expectedNext {
		return ShardEvidence{}, fmt.Errorf("ordered inputs end before expected shard range: next ledger is %d, expected %d", nextLedger, expectedNext)
	}
	expectedCount := uint64(config.EndLedger) - uint64(config.StartLedger) + 1
	if ledgerCount != expectedCount {
		return ShardEvidence{}, fmt.Errorf("ordered inputs contain %d ledgers, expected %d", ledgerCount, expectedCount)
	}
	evidence.Range.LedgerCount = ledgerCount
	return evidence, nil
}
