package input

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"os"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

type Limits struct {
	MaxCompressedBytes    int64
	MaxUncompressedBytes  int64
	MaxDecodedMemoryBytes int64
	MaxLedgers            uint64
}

type Batch struct {
	Start             uint32
	End               uint32
	LedgerCount       uint64
	CompressedBytes   int64
	UncompressedBytes int64
	CompressedSHA256  string
	XDRSHA256         string
	FirstPreviousHash xdr.Hash
	LastLedgerHash    xdr.Hash

	decoded []byte
	metas   xdr.LedgerCloseMetaBatchLedgerCloseMetasView
}

const maxXDRDepth = 1500 // Matches stellar-core and the SDK's zero-copy views.

func DecodeFile(path string, expectedStart, maximumEnd uint32, limits Limits) (*Batch, error) {
	if err := validateLimits(limits); err != nil {
		return nil, err
	}
	if expectedStart == 0 || maximumEnd < expectedStart {
		return nil, fmt.Errorf("invalid expected ledger bounds [%d,%d]", expectedStart, maximumEnd)
	}

	compressed, err := readRegularFile(path, limits.MaxCompressedBytes)
	if err != nil {
		return nil, err
	}
	compressedHash := sha256.Sum256(compressed)
	compressedSize := len(compressed)

	decoded, err := decompress(compressed, limits.MaxUncompressedBytes, limits.MaxDecodedMemoryBytes)
	if err != nil {
		return nil, fmt.Errorf("decode zstd input: %w", err)
	}
	compressed = nil

	view := xdr.LedgerCloseMetaBatchView(decoded)
	if err := view.ValidateFull(); err != nil {
		return nil, fmt.Errorf("validate LedgerCloseMetaBatch XDR: %w", err)
	}
	raw, err := view.Raw()
	if err != nil {
		return nil, fmt.Errorf("measure LedgerCloseMetaBatch XDR: %w", err)
	}
	if len(raw) != len(decoded) {
		return nil, fmt.Errorf("LedgerCloseMetaBatch XDR has %d trailing bytes", len(decoded)-len(raw))
	}

	startView, err := view.StartSequence()
	if err != nil {
		return nil, fmt.Errorf("read batch start sequence: %w", err)
	}
	start, err := startView.Value()
	if err != nil {
		return nil, fmt.Errorf("read batch start sequence: %w", err)
	}
	endView, err := view.EndSequence()
	if err != nil {
		return nil, fmt.Errorf("read batch end sequence: %w", err)
	}
	end, err := endView.Value()
	if err != nil {
		return nil, fmt.Errorf("read batch end sequence: %w", err)
	}
	if end < start {
		return nil, fmt.Errorf("decoded batch has invalid range [%d,%d]", start, end)
	}
	if start != expectedStart {
		return nil, fmt.Errorf("decoded start ledger %d does not match expected ledger %d", start, expectedStart)
	}
	if end > maximumEnd {
		return nil, fmt.Errorf("decoded end ledger %d exceeds expected shard end %d", end, maximumEnd)
	}

	metas, err := view.LedgerCloseMetas()
	if err != nil {
		return nil, fmt.Errorf("read ledger-close-meta array: %w", err)
	}
	count, err := metas.Count()
	if err != nil {
		return nil, fmt.Errorf("read ledger-close-meta count: %w", err)
	}
	expectedCount := uint64(end) - uint64(start) + 1
	if uint64(count) != expectedCount {
		return nil, fmt.Errorf("batch range contains %d ledgers but XDR contains %d", expectedCount, count)
	}
	if expectedCount > limits.MaxLedgers {
		return nil, fmt.Errorf("batch ledger count %d exceeds limit %d", expectedCount, limits.MaxLedgers)
	}
	links, err := validateMetaSequence(metas, start)
	if err != nil {
		return nil, err
	}

	xdrHash := sha256.Sum256(decoded)
	return &Batch{
		Start:             start,
		End:               end,
		LedgerCount:       expectedCount,
		CompressedBytes:   int64(compressedSize),
		UncompressedBytes: int64(len(decoded)),
		CompressedSHA256:  hex.EncodeToString(compressedHash[:]),
		XDRSHA256:         hex.EncodeToString(xdrHash[:]),
		FirstPreviousHash: links.firstPrevious,
		LastLedgerHash:    links.last,
		decoded:           decoded,
		metas:             metas,
	}, nil
}

// ForEach decodes at most one LedgerCloseMeta object at a time.
func (b *Batch) ForEach(maxMemoryBytes int64, fn func(xdr.LedgerCloseMeta) error) error {
	if b == nil || b.decoded == nil {
		return fmt.Errorf("batch is closed")
	}
	if maxMemoryBytes <= 0 {
		return fmt.Errorf("decoded memory limit must be positive")
	}
	index := 0
	for metaView, viewErr := range b.metas.Iter() {
		if viewErr != nil {
			return fmt.Errorf("read ledger-close-meta %d: %w", index, viewErr)
		}
		raw, err := metaView.Raw()
		if err != nil {
			return fmt.Errorf("measure ledger-close-meta %d: %w", index, err)
		}
		var meta xdr.LedgerCloseMeta
		opts := xdr.DecodeOptions{MaxDepth: maxXDRDepth, MaxInputLen: len(raw), MaxMemoryBytes: maxMemoryBytes}
		n, err := xdr.UnmarshalWithOptions(bytes.NewReader(raw), &meta, opts)
		if err != nil {
			return fmt.Errorf("decode ledger-close-meta %d: %w", index, err)
		}
		if n != len(raw) {
			return fmt.Errorf("ledger-close-meta %d left %d XDR bytes unread", index, len(raw)-n)
		}
		if err := fn(meta); err != nil {
			return err
		}
		index++
	}
	if uint64(index) != b.LedgerCount {
		return fmt.Errorf("decoded %d ledgers, expected %d", index, b.LedgerCount)
	}
	return nil
}

func (b *Batch) Close() {
	if b == nil {
		return
	}
	b.decoded = nil
	b.metas = nil
}

type sequenceLinks struct {
	firstPrevious xdr.Hash
	last          xdr.Hash
}

func validateMetaSequence(metas xdr.LedgerCloseMetaBatchLedgerCloseMetasView, start uint32) (sequenceLinks, error) {
	var links sequenceLinks
	var previousHash xdr.Hash
	index := 0
	for meta, viewErr := range metas.Iter() {
		if viewErr != nil {
			return links, fmt.Errorf("read ledger-close-meta %d: %w", index, viewErr)
		}
		versionView, err := meta.V()
		if err != nil {
			return links, fmt.Errorf("read ledger-close-meta %d version: %w", index, err)
		}
		version, err := versionView.Value()
		if err != nil {
			return links, fmt.Errorf("read ledger-close-meta %d version: %w", index, err)
		}
		if version < 0 || version > 2 {
			return links, fmt.Errorf("ledger-close-meta %d has unsupported version %d", index, version)
		}
		sequence, err := meta.LedgerSequence()
		if err != nil {
			return links, fmt.Errorf("read ledger-close-meta %d sequence: %w", index, err)
		}
		expected := uint64(start) + uint64(index)
		if uint64(sequence) != expected {
			return links, fmt.Errorf("ledger-close-meta %d has sequence %d, expected %d", index, sequence, expected)
		}
		ledgerHash, err := meta.LedgerHash()
		if err != nil {
			return links, fmt.Errorf("read ledger-close-meta %d hash: %w", index, err)
		}
		if len(ledgerHash) != 32 {
			return links, fmt.Errorf("ledger-close-meta %d hash has length %d, expected 32", index, len(ledgerHash))
		}
		parent, parentErr := meta.PreviousLedgerHash()
		if parentErr != nil {
			return links, fmt.Errorf("read ledger-close-meta %d parent hash: %w", index, parentErr)
		}
		if len(parent) != 32 {
			return links, fmt.Errorf("ledger-close-meta %d parent hash has length %d, expected 32", index, len(parent))
		}
		if index == 0 {
			copy(links.firstPrevious[:], parent)
		} else if !bytes.Equal(parent, previousHash[:]) {
			return links, fmt.Errorf("ledger-close-meta %d does not link to the preceding ledger", index)
		}
		copy(previousHash[:], ledgerHash)
		copy(links.last[:], ledgerHash)
		index++
	}
	if index == 0 {
		return links, fmt.Errorf("ledger-close-meta batch is empty")
	}
	return links, nil
}

func readRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("stat input: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("input must be a regular file")
	}
	if info.Size() > limit {
		return nil, fmt.Errorf("compressed input size %d exceeds limit %d", info.Size(), limit)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open input: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read input: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("compressed input exceeds limit %d", limit)
	}
	return data, nil
}

func decompress(compressed []byte, outputLimit, memoryLimit int64) ([]byte, error) {
	decoder, err := zstd.NewReader(
		bytes.NewReader(compressed),
		zstd.WithDecoderConcurrency(1),
		zstd.WithDecoderMaxMemory(uint64(memoryLimit)),
	)
	if err != nil {
		return nil, err
	}
	defer decoder.Close()
	decoded, err := io.ReadAll(io.LimitReader(decoder, outputLimit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(decoded)) > outputLimit {
		return nil, fmt.Errorf("uncompressed XDR exceeds limit %d", outputLimit)
	}
	return decoded, nil
}

func validateLimits(limits Limits) error {
	if limits.MaxCompressedBytes <= 0 || limits.MaxCompressedBytes == math.MaxInt64 {
		return fmt.Errorf("compressed byte limit must be in [1,%d]", int64(math.MaxInt64-1))
	}
	if limits.MaxUncompressedBytes <= 0 || limits.MaxUncompressedBytes == math.MaxInt64 {
		return fmt.Errorf("uncompressed byte limit must be in [1,%d]", int64(math.MaxInt64-1))
	}
	if limits.MaxDecodedMemoryBytes <= 0 {
		return fmt.Errorf("decoded memory limit must be positive")
	}
	if limits.MaxLedgers == 0 {
		return fmt.Errorf("ledger count limit must be positive")
	}
	return nil
}
