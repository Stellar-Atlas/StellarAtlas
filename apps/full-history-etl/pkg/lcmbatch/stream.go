package lcmbatch

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"os"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

// StreamFile is for a single registered canonical file. It never assembles
// either the compressed input or expanded batch in RAM or in a scratch file.
// Results written by visit remain private until the caller verifies both ends.
func StreamFile(ctx context.Context, path string, start, end uint32, lim Limits, visit func(xdr.LedgerCloseMeta) error) (*Batch, error) {
	return streamFile(ctx, path, start, end, lim, nil, visit)
}

// SourceFrame describes the original uncompressed LedgerCloseMetaBatch,
// including its original 12-byte start/end/count header. Only this header
// changes when multiple registered source files are joined into one export.
type SourceFrame struct {
	Start, End uint32
	Bytes      int64
	SHA256     string
}

func StreamRegisteredFile(ctx context.Context, path string, start, end uint32, lim Limits, frames []SourceFrame, visit func(xdr.LedgerCloseMeta) error) (*Batch, error) {
	if len(frames) == 0 || uint64(len(frames)) > lim.MaxLedgers {
		return nil, fmt.Errorf("invalid registered source frame count")
	}
	return streamFile(ctx, path, start, end, lim, frames, visit)
}

func streamFile(ctx context.Context, path string, start, end uint32, lim Limits, frames []SourceFrame, visit func(xdr.LedgerCloseMeta) error) (*Batch, error) {
	if err := validateLimits(lim); err != nil {
		return nil, err
	}
	if start == 0 || end < start || uint64(end)-uint64(start)+1 > lim.MaxLedgers || visit == nil {
		return nil, fmt.Errorf("invalid replay range")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() > lim.MaxCompressedBytes {
		return nil, fmt.Errorf("invalid compressed replay size")
	}
	cHash, xHash := sha256.New(), sha256.New()
	compressed := &io.LimitedReader{R: f, N: st.Size()}
	z, err := zstd.NewReader(io.TeeReader(compressed, cHash), zstd.WithDecoderConcurrency(1), zstd.WithDecoderLowmem(true), zstd.WithDecoderMaxMemory(uint64(lim.MaxDecodedMemoryBytes)))
	if err != nil {
		return nil, err
	}
	defer z.Close()
	// Buffer BEFORE limiting each ledger. The SDK makes many small primitive
	// reads; buffered lookahead belongs to the next ledger and is never lost.
	total := &io.LimitedReader{R: z, N: lim.MaxUncompressedBytes + 1}
	wire := bufio.NewReaderSize(io.TeeReader(total, xHash), 64<<10)
	var header [12]byte
	if _, err := io.ReadFull(wire, header[:]); err != nil {
		return nil, err
	}
	count := uint64(end) - uint64(start) + 1
	if binary.BigEndian.Uint32(header[:4]) != start || binary.BigEndian.Uint32(header[4:8]) != end || uint64(binary.BigEndian.Uint32(header[8:])) != count {
		return nil, fmt.Errorf("canonical replay header does not match the registered range")
	}
	b := &Batch{Start: start, End: end, LedgerCount: count}
	var frameLimit *io.LimitedReader
	var frameHash hash.Hash
	var ledgerInput io.Reader = wire
	frameIndex := 0
	for i := uint64(0); i < count; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// The input budget and the SDK's allocation/depth budget apply afresh
		// to THIS ledger, independently of total bytes read across the shard.
		limit := min(lim.MaxDecodedMemoryBytes, lim.MaxUncompressedBytes)
		seq := uint64(start) + i
		if len(frames) > 0 && frameLimit == nil {
			if frameIndex >= len(frames) {
				return nil, fmt.Errorf("missing registered source frame")
			}
			spec := frames[frameIndex]
			if uint64(spec.Start) != seq || spec.End < spec.Start || spec.End > end || spec.Bytes <= 12 {
				return nil, fmt.Errorf("invalid registered source frame boundary")
			}
			var hdr [12]byte
			binary.BigEndian.PutUint32(hdr[:4], spec.Start)
			binary.BigEndian.PutUint32(hdr[4:8], spec.End)
			binary.BigEndian.PutUint32(hdr[8:], spec.End-spec.Start+1)
			frameHash = sha256.New()
			frameHash.Write(hdr[:])
			frameLimit = &io.LimitedReader{R: wire, N: spec.Bytes - 12}
			ledgerInput = io.TeeReader(frameLimit, frameHash)
		}
		one := &io.LimitedReader{R: ledgerInput, N: limit}
		var m xdr.LedgerCloseMeta
		n, err := xdr.UnmarshalWithOptions(one, &m, xdr.DecodeOptions{MaxDepth: maxXDRDepth, MaxInputLen: int(limit), MaxMemoryBytes: lim.MaxDecodedMemoryBytes})
		if err != nil || n <= 0 || int64(n) != limit-one.N {
			return nil, fmt.Errorf("cannot decode bounded ledger %d: %v", uint64(start)+i, err)
		}
		if m.V < 0 || m.V > 2 {
			return nil, fmt.Errorf("unsupported ledger-close metadata version")
		}
		h := m.LedgerHeaderHistoryEntry()
		if uint64(h.Header.LedgerSeq) != uint64(start)+i || (i != 0 && h.Header.PreviousLedgerHash != b.LastLedgerHash) {
			return nil, fmt.Errorf("canonical ledger sequence or parent mismatch")
		}
		if i == 0 {
			b.FirstPreviousHash = h.Header.PreviousLedgerHash
		}
		b.LastLedgerHash = h.Hash
		if len(frames) > 0 && seq == uint64(frames[frameIndex].End) {
			if frameLimit.N != 0 || hex.EncodeToString(frameHash.Sum(nil)) != frames[frameIndex].SHA256 {
				return nil, fmt.Errorf("registered source XDR length or digest mismatch for %d-%d", frames[frameIndex].Start, frames[frameIndex].End)
			}
			frameIndex++
			frameLimit = nil
			ledgerInput = wire
		}
		if err := visit(m); err != nil {
			return nil, err
		}
	}
	if _, err := wire.ReadByte(); err != io.EOF || total.N == 0 || compressed.N != 0 || frameIndex != len(frames) {
		return nil, fmt.Errorf("canonical replay has trailing, oversized or incomplete bytes")
	}
	b.CompressedBytes = st.Size()
	b.UncompressedBytes = lim.MaxUncompressedBytes + 1 - total.N
	b.CompressedSHA256 = hex.EncodeToString(cHash.Sum(nil))
	b.XDRSHA256 = hex.EncodeToString(xHash.Sum(nil))
	return b, nil
}
