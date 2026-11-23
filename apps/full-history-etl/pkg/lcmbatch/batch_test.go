package lcmbatch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

const fixtureName = "FCD285FF--53312000.xdr.zstd"

func TestStreamFileUsesPerLedgerBoundsAndRejectsTrailingData(t *testing.T) {
	lim := testLimits()
	ctx := context.Background()
	b, err := StreamFile(ctx, fixturePath(), 53312000, 53312000, lim, func(m xdr.LedgerCloseMeta) error {
		if m.CountTransactions() != 163 {
			t.Fatalf("lost transactions: %d", m.CountTransactions())
		}
		return nil
	})
	if err != nil || b.XDRSHA256 != "074cf6df5db754bf7488d4d7c65604f2f9e6f7e241212b5328c6012ca4bbf205" || b.UncompressedBytes != 372492 || b.CompressedBytes != 72651 {
		t.Fatalf("stream differs from retained fixture: %+v, %v", b, err)
	}
	// Build 1,024 individually small, linked ledgers. Make the total wire
	// size larger than the permitted per-ledger memory to catch bulk decode.
	var base xdr.LedgerCloseMeta
	_, err = StreamFile(ctx, fixturePath(), 53312000, 53312000, lim, func(m xdr.LedgerCloseMeta) error { base = m; return nil })
	if err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	const start, count = uint32(91), uint32(1024)
	for _, v := range []uint32{start, start + count - 1, count} {
		if err := binary.Write(&raw, binary.BigEndian, v); err != nil {
			t.Fatal(err)
		}
	}
	var last xdr.Hash
	frames := make([]SourceFrame, 0, count/2)
	var framed bytes.Buffer
	for seq := start; seq < start+count; seq++ {
		h := base.LedgerHeaderHistoryEntry()
		h.Header.LedgerSeq = xdr.Uint32(seq)
		h.Header.PreviousLedgerHash = last
		h.Hash, err = xdr.HashXdr(&h.Header)
		if err != nil {
			t.Fatal(err)
		}
		last = h.Hash
		m := xdr.LedgerCloseMeta{V: 0, V0: &xdr.LedgerCloseMetaV0{LedgerHeader: h}}
		if (seq-start)%2 == 0 {
			framed.Reset()
			for _, v := range []uint32{seq, seq + 1, 2} {
				if err := binary.Write(&framed, binary.BigEndian, v); err != nil {
					t.Fatal(err)
				}
			}
		}
		if _, err = xdr.Marshal(io.MultiWriter(&raw, &framed), m); err != nil {
			t.Fatal(err)
		}
		if (seq-start)%2 == 1 {
			sum := sha256.Sum256(framed.Bytes())
			frames = append(frames, SourceFrame{Start: seq - 1, End: seq, Bytes: int64(framed.Len()), SHA256: hex.EncodeToString(sum[:])})
		}
	}
	lim.MaxDecodedMemoryBytes = 256 << 10
	if int64(raw.Len()) <= lim.MaxDecodedMemoryBytes {
		t.Fatal("fixture doesn't exercise streaming limit")
	}
	lim.MaxUncompressedBytes = int64(raw.Len())
	lim.MaxLedgers = uint64(count)
	p := filepath.Join(t.TempDir(), "canonical.zst")
	enc, err := zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1), zstd.WithWindowSize(128<<10))
	if err != nil {
		t.Fatal(err)
	}
	defer enc.Close()
	write := func(data []byte) {
		if err := os.WriteFile(p, enc.EncodeAll(data, nil), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(raw.Bytes())
	var seen uint32
	_, err = StreamRegisteredFile(ctx, p, start, start+count-1, lim, frames, func(m xdr.LedgerCloseMeta) error {
		if uint32(m.LedgerSequence()) != start+seen {
			t.Fatalf("out of order")
		}
		seen++
		return nil
	})
	if err != nil || seen != count {
		t.Fatalf("stream of %d ledgers stopped at %d: %v", count, seen, err)
	}
	badFrames := append([]SourceFrame(nil), frames...)
	badFrames[1].SHA256 = strings.Repeat("0", 64)
	if _, err := StreamRegisteredFile(ctx, p, start, start+count-1, lim, badFrames, func(xdr.LedgerCloseMeta) error { return nil }); err == nil {
		t.Fatal("accepted incorrect original-frame digest")
	}
	badFrames[1] = frames[1]
	badFrames[1].Bytes++
	if _, err := StreamRegisteredFile(ctx, p, start, start+count-1, lim, badFrames, func(xdr.LedgerCloseMeta) error { return nil }); err == nil {
		t.Fatal("accepted incorrect original-frame length")
	}
	write(append(raw.Bytes(), 0))
	if _, err = StreamFile(ctx, p, start, start+count-1, lim, func(xdr.LedgerCloseMeta) error { return nil }); err == nil {
		t.Fatal("accepted extra XDR")
	}
}

func TestDecodeFileRealLedgerCloseMetaBatch(t *testing.T) {
	batch, err := DecodeFile(fixturePath(), 53312000, 53312000, testLimits())
	if err != nil {
		t.Fatalf("DecodeFile: %v", err)
	}
	defer batch.Close()

	if batch.Start != 53312000 || batch.End != 53312000 || batch.LedgerCount != 1 {
		t.Fatalf("unexpected range: %+v", batch)
	}
	if batch.CompressedBytes != 72651 || batch.UncompressedBytes != 372492 {
		t.Fatalf("unexpected byte counts: compressed=%d XDR=%d", batch.CompressedBytes, batch.UncompressedBytes)
	}
	if batch.CompressedSHA256 != "5c6e4746eb4e7a6e1fdca74e64639bbb5981f8caf8634c5a33bd007c942b178d" {
		t.Fatalf("unexpected compressed digest: %s", batch.CompressedSHA256)
	}
	if batch.XDRSHA256 != "074cf6df5db754bf7488d4d7c65604f2f9e6f7e241212b5328c6012ca4bbf205" {
		t.Fatalf("unexpected XDR digest: %s", batch.XDRSHA256)
	}

	decoded := 0
	err = batch.ForEach(testLimits().MaxDecodedMemoryBytes, func(meta xdr.LedgerCloseMeta) error {
		decoded++
		if meta.LedgerSequence() != 53312000 {
			t.Fatalf("unexpected ledger sequence: %d", meta.LedgerSequence())
		}
		if meta.CountTransactions() != 163 {
			t.Fatalf("unexpected transaction count: %d", meta.CountTransactions())
		}
		return nil
	})
	if err != nil {
		t.Fatalf("ForEach: %v", err)
	}
	if decoded != 1 {
		t.Fatalf("decoded %d ledgers, expected 1", decoded)
	}
}

func TestDecodeFileRejectsRangeMismatchAndCompressedLimit(t *testing.T) {
	_, err := DecodeFile(fixturePath(), 53311999, 53311999, testLimits())
	if err == nil || !strings.Contains(err.Error(), "does not match expected ledger") {
		t.Fatalf("expected range mismatch, got %v", err)
	}

	limits := testLimits()
	limits.MaxCompressedBytes = 10
	_, err = DecodeFile(fixturePath(), 53312000, 53312000, limits)
	if err == nil || !strings.Contains(err.Error(), "exceeds limit") {
		t.Fatalf("expected compressed limit error, got %v", err)
	}
}

func TestDecodeFileRejectsTrailingXDR(t *testing.T) {
	compressed, err := os.ReadFile(fixturePath())
	if err != nil {
		t.Fatal(err)
	}
	decoder, err := zstd.NewReader(bytes.NewReader(compressed), zstd.WithDecoderConcurrency(1))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(decoder)
	decoder.Close()
	if err != nil {
		t.Fatal(err)
	}
	decoded = append(decoded, 0, 0, 0, 0)
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1))
	if err != nil {
		t.Fatal(err)
	}
	malformed := encoder.EncodeAll(decoded, nil)
	encoder.Close()
	path := filepath.Join(t.TempDir(), "trailing.xdr.zstd")
	if err := os.WriteFile(path, malformed, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = DecodeFile(path, 53312000, 53312000, testLimits())
	if err == nil || !strings.Contains(err.Error(), "trailing bytes") {
		t.Fatalf("expected trailing XDR rejection, got %v", err)
	}
}

func fixturePath() string {
	return filepath.Join("..", "..", "internal", "testdata", fixtureName)
}

func testLimits() Limits {
	return Limits{
		MaxCompressedBytes:    1 << 20,
		MaxUncompressedBytes:  64 << 20,
		MaxDecodedMemoryBytes: 64 << 20,
		MaxLedgers:            1,
	}
}
