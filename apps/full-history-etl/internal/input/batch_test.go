package input

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

const fixtureName = "FCD285FF--53312000.xdr.zstd"

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
	return filepath.Join("..", "testdata", fixtureName)
}

func testLimits() Limits {
	return Limits{
		MaxCompressedBytes:    1 << 20,
		MaxUncompressedBytes:  64 << 20,
		MaxDecodedMemoryBytes: 64 << 20,
		MaxLedgers:            1,
	}
}
