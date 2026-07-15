package app

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	batchinput "github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/input"
	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
)

func TestRunMultiInputShardAndExactReplay(t *testing.T) {
	sources := contiguousFixtureSources(t, 2)
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312001")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312001)

	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("Run multi-input shard: %v", err)
	}
	if receipt.Range != (ManifestRange{StartLedger: 53312000, EndLedger: 53312001, LedgerCount: 2}) {
		t.Fatalf("unexpected aggregate range: %+v", receipt.Range)
	}
	if len(receipt.SourceObjects) != 2 {
		t.Fatalf("got %d source evidence rows, expected 2", len(receipt.SourceObjects))
	}
	for index, source := range receipt.SourceObjects {
		sequence := uint32(53312000 + index)
		if source.ObjectKey != sources[index].ObjectKey || source.StartLedger != sequence || source.EndLedger != sequence || source.LedgerCount != 1 {
			t.Fatalf("unexpected source evidence %d: %+v", index, source)
		}
		if source.CompressedByteCount <= 0 || source.XDRByteCount <= 0 || len(source.CompressedSHA256) != 64 || len(source.XDRSHA256) != 64 || len(source.FirstPreviousLedgerHash) != 64 || len(source.LastLedgerHash) != 64 {
			t.Fatalf("incomplete source evidence %d: %+v", index, source)
		}
		if index > 0 && source.FirstPreviousLedgerHash != receipt.SourceObjects[index-1].LastLedgerHash {
			t.Fatalf("source evidence %d does not link to its predecessor", index)
		}
	}
	wantCounts := map[string]uint64{
		"ledger-close-meta":       2,
		"ledgers":                 2,
		"transactions":            326,
		"transaction-results":     326,
		"transaction-meta":        326,
		"operations":              468,
		"contract-events":         42,
		"ledger-entry-changes":    1758,
		"account-state-changes":   1002,
		"trustline-state-changes": 374,
	}
	for _, descriptor := range receipt.Outputs {
		if descriptor.RecordCount != wantCounts[descriptor.Dataset] {
			t.Fatalf("unexpected %s count: %d", descriptor.Dataset, descriptor.RecordCount)
		}
	}
	manifestPath := checkedStoragePath(t, root, receipt.ManifestStorageKey)
	manifestBefore, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range sources {
		if bytes.Contains(manifestBefore, []byte(source.Path)) {
			t.Fatalf("manifest retained local source path %q", source.Path)
		}
	}

	replayed, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("recover multi-input replay: %v", err)
	}
	if !reflect.DeepEqual(receipt, replayed) {
		t.Fatalf("multi-input replay receipt changed")
	}
	manifestAfter, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(manifestBefore, manifestAfter) {
		t.Fatal("multi-input replay rewrote manifest")
	}
}

func TestRunRejectsGapDuplicateAndMisorderedInputsWithCleanup(t *testing.T) {
	sources := contiguousFixtureSources(t, 3)
	tests := []struct {
		name    string
		sources []Source
		end     uint32
	}{
		{name: "gap", sources: []Source{sources[0], sources[2]}, end: 53312002},
		{name: "duplicate", sources: []Source{sources[0], {Path: sources[0].Path, ObjectKey: "pubnet/ledger/53312000-copy.xdr.zstd"}}, end: 53312001},
		{name: "misordered", sources: []Source{sources[1], sources[0]}, end: 53312001},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			outputDirectory := filepath.Join(root, test.name, "typed-shard")
			config := multiInputConfig(root, outputDirectory, test.sources, 53312000, test.end)
			_, err := Run(context.Background(), config)
			if err == nil || !strings.Contains(err.Error(), "does not match expected ledger") {
				t.Fatalf("expected ordered continuity rejection, got %v", err)
			}
			if _, statErr := os.Stat(outputDirectory); !os.IsNotExist(statErr) {
				t.Fatalf("invalid shard output was retained: %v", statErr)
			}
			assertNoStagingDirectories(t, filepath.Dir(outputDirectory))
		})
	}
}

func TestRunEnforcesAggregateInputLimitsWithCleanup(t *testing.T) {
	sources := contiguousFixtureSources(t, 2)
	root := t.TempDir()
	baseConfig := multiInputConfig(root, filepath.Join(root, "inspect"), sources, 53312000, 53312001)
	evidence, err := inspectSources(context.Background(), baseConfig)
	if err != nil {
		t.Fatalf("inspect fixture sources: %v", err)
	}
	var compressedBytes, xdrBytes int64
	for _, source := range evidence.SourceObjects {
		compressedBytes += source.CompressedByteCount
		xdrBytes += source.XDRByteCount
	}

	tests := []struct {
		name      string
		configure func(*Config)
		wantError string
	}{
		{
			name: "compressed",
			configure: func(config *Config) {
				config.MaxCompressedBytes = compressedBytes - 1
			},
			wantError: "compressed input size",
		},
		{
			name: "uncompressed XDR",
			configure: func(config *Config) {
				config.MaxUncompressedBytes = xdrBytes - 1
			},
			wantError: "uncompressed XDR exceeds limit",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			outputDirectory := filepath.Join(root, test.name, "typed-shard")
			config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312001)
			test.configure(&config)

			_, err := Run(context.Background(), config)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("expected aggregate limit rejection containing %q, got %v", test.wantError, err)
			}
			if _, statErr := os.Stat(outputDirectory); !os.IsNotExist(statErr) {
				t.Fatalf("limited shard output was retained: %v", statErr)
			}
			assertNoStagingDirectories(t, filepath.Dir(outputDirectory))
		})
	}
}

func TestRunEnforcesAggregateOutputLimitWithCleanup(t *testing.T) {
	sources := contiguousFixtureSources(t, 2)
	root := t.TempDir()
	baselinePath := filepath.Join(root, "baseline", "typed-shard")
	baselineConfig := multiInputConfig(root, baselinePath, sources, 53312000, 53312001)
	receipt, err := Run(context.Background(), baselineConfig)
	if err != nil {
		t.Fatalf("publish baseline shard: %v", err)
	}
	var totalBytes, largestFile int64
	for _, descriptor := range receipt.Outputs {
		totalBytes += descriptor.ByteCount
		if descriptor.ByteCount > largestFile {
			largestFile = descriptor.ByteCount
		}
	}
	if totalBytes-1 <= largestFile {
		t.Fatalf("fixture cannot distinguish aggregate and per-file budgets: total=%d largest=%d", totalBytes, largestFile)
	}

	outputDirectory := filepath.Join(root, "limited", "typed-shard")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312001)
	config.MaxOutputBytes = totalBytes - 1
	_, err = Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "aggregate parquet output exceeds byte limit") {
		t.Fatalf("expected aggregate output limit rejection, got %v", err)
	}
	if _, statErr := os.Stat(outputDirectory); !os.IsNotExist(statErr) {
		t.Fatalf("limited shard output was retained: %v", statErr)
	}
	assertNoStagingDirectories(t, filepath.Dir(outputDirectory))
}

func TestRunEnforcesAggregateLedgerLimit(t *testing.T) {
	sources := contiguousFixtureSources(t, 2)
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "limited", "typed-shard")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312001)
	config.MaxLedgers = 1

	_, err := Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "expected ledger count 2 exceeds limit 1") {
		t.Fatalf("expected aggregate ledger limit rejection, got %v", err)
	}
	if _, statErr := os.Stat(outputDirectory); !os.IsNotExist(statErr) {
		t.Fatalf("limited shard output was retained: %v", statErr)
	}
}

func TestRunReplayRequiresCurrentProcessingLimits(t *testing.T) {
	sources := contiguousFixtureSources(t, 1)
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "typed-shard")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312000)
	if _, err := Run(context.Background(), config); err != nil {
		t.Fatalf("publish initial shard: %v", err)
	}

	config.MaxRows = 1
	_, err := Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "processing limits") {
		t.Fatalf("expected replay limit mismatch, got %v", err)
	}
}

func TestRunReplayRejectsDifferentValidSourceBytes(t *testing.T) {
	sources := contiguousFixtureSources(t, 1)
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "typed-shard")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312000)
	if _, err := Run(context.Background(), config); err != nil {
		t.Fatalf("publish initial shard: %v", err)
	}

	changed := loadFixtureMeta(t, sources[0].Path, 53312000)
	header := ledgerHeader(&changed)
	header.Header.ScpValue.CloseTime++
	hash, err := xdr.HashXdr(&header.Header)
	if err != nil {
		t.Fatal(err)
	}
	header.Hash = hash
	changedPath := filepath.Join(t.TempDir(), "changed.xdr.zstd")
	writeBatchFile(t, changedPath, changed)
	config.Sources = []Source{{Path: changedPath, ObjectKey: sources[0].ObjectKey}}

	_, err = Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "source object evidence") {
		t.Fatalf("expected different-byte replay rejection, got %v", err)
	}
}

func TestRunRejectsBrokenLinkBetweenSourceObjects(t *testing.T) {
	sources := contiguousFixtureSources(t, 2)
	second := loadFixtureMeta(t, sources[1].Path, 53312001)
	header := ledgerHeader(&second)
	header.Header.PreviousLedgerHash = xdr.Hash{}
	hash, err := xdr.HashXdr(&header.Header)
	if err != nil {
		t.Fatal(err)
	}
	header.Hash = hash
	brokenPath := filepath.Join(t.TempDir(), "broken.xdr.zstd")
	writeBatchFile(t, brokenPath, second)
	sources[1] = Source{Path: brokenPath, ObjectKey: sources[1].ObjectKey}

	root := t.TempDir()
	outputDirectory := filepath.Join(root, "typed-shard")
	config := multiInputConfig(root, outputDirectory, sources, 53312000, 53312001)
	_, err = Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "does not link") {
		t.Fatalf("expected cross-object linkage rejection, got %v", err)
	}
	if _, statErr := os.Stat(outputDirectory); !os.IsNotExist(statErr) {
		t.Fatalf("broken-link output was retained: %v", statErr)
	}
}

func contiguousFixtureSources(t *testing.T, count int) []Source {
	t.Helper()
	if count < 1 {
		t.Fatal("fixture source count must be positive")
	}
	fixturePath := filepath.Join("..", "testdata", "FCD285FF--53312000.xdr.zstd")
	sources := []Source{{Path: fixturePath, ObjectKey: "pubnet/ledger/53312000.xdr.zstd"}}
	meta := loadFixtureMeta(t, fixturePath, 53312000)
	directory := t.TempDir()
	for index := 1; index < count; index++ {
		sequence := uint32(53312000 + index)
		meta = successorMeta(t, meta, sequence)
		path := filepath.Join(directory, fmt.Sprintf("%d.xdr.zstd", sequence))
		writeBatchFile(t, path, meta)
		sources = append(sources, Source{
			Path:      path,
			ObjectKey: fmt.Sprintf("pubnet/ledger/%d.xdr.zstd", sequence),
		})
	}
	return sources
}

func loadFixtureMeta(t *testing.T, fixturePath string, expectedSequence uint32) xdr.LedgerCloseMeta {
	t.Helper()
	limits := batchinput.Limits{
		MaxCompressedBytes:    1 << 20,
		MaxUncompressedBytes:  64 << 20,
		MaxDecodedMemoryBytes: 64 << 20,
		MaxLedgers:            1,
	}
	batch, err := batchinput.DecodeFile(fixturePath, expectedSequence, expectedSequence, limits)
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Close()
	var result xdr.LedgerCloseMeta
	if err := batch.ForEach(limits.MaxDecodedMemoryBytes, func(meta xdr.LedgerCloseMeta) error {
		result = meta
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return result
}

func successorMeta(t *testing.T, previous xdr.LedgerCloseMeta, sequence uint32) xdr.LedgerCloseMeta {
	t.Helper()
	var encoded bytes.Buffer
	if _, err := xdr.Marshal(&encoded, previous); err != nil {
		t.Fatal(err)
	}
	var next xdr.LedgerCloseMeta
	if _, err := xdr.Unmarshal(bytes.NewReader(encoded.Bytes()), &next); err != nil {
		t.Fatal(err)
	}
	header := ledgerHeader(&next)
	header.Header.LedgerSeq = xdr.Uint32(sequence)
	header.Header.PreviousLedgerHash = previous.LedgerHeaderHistoryEntry().Hash
	header.Header.ScpValue.CloseTime++
	hash, err := xdr.HashXdr(&header.Header)
	if err != nil {
		t.Fatal(err)
	}
	header.Hash = hash
	return next
}

func ledgerHeader(meta *xdr.LedgerCloseMeta) *xdr.LedgerHeaderHistoryEntry {
	switch meta.V {
	case 0:
		return &meta.V0.LedgerHeader
	case 1:
		return &meta.V1.LedgerHeader
	case 2:
		return &meta.V2.LedgerHeader
	default:
		panic(fmt.Sprintf("unsupported fixture LedgerCloseMeta version %d", meta.V))
	}
}

func writeBatchFile(t *testing.T, path string, meta xdr.LedgerCloseMeta) {
	t.Helper()
	sequence := meta.LedgerSequence()
	batch := xdr.LedgerCloseMetaBatch{
		StartSequence:    xdr.Uint32(sequence),
		EndSequence:      xdr.Uint32(sequence),
		LedgerCloseMetas: []xdr.LedgerCloseMeta{meta},
	}
	var encoded bytes.Buffer
	if _, err := xdr.Marshal(&encoded, batch); err != nil {
		t.Fatal(err)
	}
	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1))
	if err != nil {
		t.Fatal(err)
	}
	compressed := encoder.EncodeAll(encoded.Bytes(), nil)
	encoder.Close()
	if err := os.WriteFile(path, compressed, 0o600); err != nil {
		t.Fatal(err)
	}
}

func multiInputConfig(root, outputDirectory string, sources []Source, start, end uint32) Config {
	config := fixtureConfig(root, outputDirectory)
	config.Sources = append([]Source(nil), sources...)
	config.StartLedger = start
	config.EndLedger = end
	config.MaxCompressedBytes = 4 << 20
	config.MaxUncompressedBytes = 256 << 20
	config.MaxLedgers = uint64(end) - uint64(start) + 1
	config.MaxRows = 50_000
	return config
}
