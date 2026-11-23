package app

import (
	"context"
	"encoding/hex"
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/transform"
	batchinput "github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type ShardEvidence struct {
	Range         ManifestRange
	SourceObjects []SourceEvidence
}

func inspectSources(ctx context.Context, config Config) (ShardEvidence, error) {
	return walkSources(ctx, config, nil)
}

// A cold read has exactly one canonical source, whose digest and output
// descriptor are checked by runReconstruction before its result is published.
func streamCanonicalSource(ctx context.Context, c Config, p *transform.Processor) (ShardEvidence, error) {
	b, err := batchinput.StreamFile(ctx, c.Sources[0].Path, c.StartLedger, c.EndLedger, batchinput.Limits{
		MaxCompressedBytes: c.MaxCompressedBytes, MaxUncompressedBytes: c.MaxUncompressedBytes,
		MaxDecodedMemoryBytes: c.MaxDecodedMemoryBytes, MaxLedgers: c.MaxLedgers,
	}, p.ProcessLedger)
	if err != nil {
		return ShardEvidence{}, err
	}
	if b.UncompressedBytes != c.MaxUncompressedBytes {
		return ShardEvidence{}, fmt.Errorf("canonical XDR length differs from registered source lengths")
	}
	return ShardEvidence{Range: ManifestRange{StartLedger: b.Start, EndLedger: b.End, LedgerCount: b.LedgerCount}, SourceObjects: []SourceEvidence{sourceEvidence(c.Sources[0], b)}}, nil
}

func sourceEvidence(s Source, b *batchinput.Batch) SourceEvidence {
	return SourceEvidence{ObjectKey: s.ObjectKey, StartLedger: b.Start, EndLedger: b.End, LedgerCount: b.LedgerCount,
		CompressedByteCount: b.CompressedBytes, CompressedSHA256: b.CompressedSHA256,
		FirstPreviousLedgerHash: hex.EncodeToString(b.FirstPreviousHash[:]), LastLedgerHash: hex.EncodeToString(b.LastLedgerHash[:]),
		XDRByteCount: b.UncompressedBytes, XDRSHA256: b.XDRSHA256}
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

		evidence.SourceObjects = append(evidence.SourceObjects, sourceEvidence(source, batch))
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
