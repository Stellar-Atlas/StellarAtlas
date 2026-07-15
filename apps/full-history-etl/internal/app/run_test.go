package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/reader"
)

const publicNetworkPassphrase = "Public Global Stellar Network ; September 2015"

func TestRunPublishesTypedParquetAndRecoversExactReplay(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	receipt, err := Run(context.Background(), fixtureConfig(root, outputDirectory))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	wantCounts := map[string]uint64{
		"ledger-close-meta":       1,
		"ledgers":                 1,
		"transactions":            163,
		"transaction-results":     163,
		"transaction-meta":        163,
		"operations":              234,
		"contract-events":         21,
		"ledger-entry-changes":    879,
		"account-state-changes":   501,
		"trustline-state-changes": 187,
	}
	wantOutputOrder := []string{
		"ledger-close-meta", "ledgers", "transactions", "operations", "transaction-results",
		"transaction-meta", "contract-events", "ledger-entry-changes", "account-state-changes", "trustline-state-changes",
	}
	if len(receipt.Outputs) != len(wantCounts) {
		t.Fatalf("got %d outputs, expected %d", len(receipt.Outputs), len(wantCounts))
	}
	for index, descriptor := range receipt.Outputs {
		if descriptor.Dataset != wantOutputOrder[index] {
			t.Fatalf("output %d is %q, expected %q", index, descriptor.Dataset, wantOutputOrder[index])
		}
		wantCount, supported := wantCounts[descriptor.Dataset]
		if !supported {
			t.Fatalf("unexpected dataset %q", descriptor.Dataset)
		}
		if descriptor.SchemaVersion == "" || descriptor.RecordCount != wantCount {
			t.Fatalf("unexpected descriptor for %s: %+v", descriptor.Dataset, descriptor)
		}
		wantRepresentation := "typed-projection"
		if descriptor.Dataset == "ledger-close-meta" {
			wantRepresentation = "lossless-replay"
		}
		if descriptor.Representation != wantRepresentation {
			t.Fatalf("unexpected %s representation: %s", descriptor.Dataset, descriptor.Representation)
		}
		filePath := checkedStoragePath(t, root, descriptor.StorageKey)
		info, err := os.Stat(filePath)
		if err != nil {
			t.Fatalf("stat %s: %v", descriptor.Dataset, err)
		}
		if info.Size() != descriptor.ByteCount {
			t.Fatalf("%s byte count is %d, manifest says %d", descriptor.Dataset, info.Size(), descriptor.ByteCount)
		}
		if digestPath(t, filePath) != descriptor.SHA256 {
			t.Fatalf("%s digest mismatch", descriptor.Dataset)
		}
		if descriptor.Dataset == "ledger-close-meta" {
			assertCanonicalLedgerCloseMeta(t, filePath, receipt.SourceObjects)
		} else {
			assertParquetRows(t, filePath, descriptor.RecordCount)
		}
	}

	if receipt.Range != (ManifestRange{StartLedger: 53312000, EndLedger: 53312000, LedgerCount: 1}) {
		t.Fatalf("unexpected receipt range: %+v", receipt.Range)
	}
	if len(receipt.SourceObjects) != 1 {
		t.Fatalf("unexpected source evidence count: %d", len(receipt.SourceObjects))
	}
	source := receipt.SourceObjects[0]
	if source.ObjectKey != "pubnet/ledger/53312000.xdr.zstd" || source.StartLedger != 53312000 ||
		source.EndLedger != 53312000 || source.LedgerCount != 1 {
		t.Fatalf("unexpected source identity: %+v", source)
	}
	if source.CompressedByteCount != 72651 || source.XDRByteCount != 372492 {
		t.Fatalf("unexpected input byte counts: %+v", source)
	}
	if source.CompressedSHA256 != "5c6e4746eb4e7a6e1fdca74e64639bbb5981f8caf8634c5a33bd007c942b178d" {
		t.Fatalf("unexpected compressed digest: %s", source.CompressedSHA256)
	}
	if source.XDRSHA256 != "074cf6df5db754bf7488d4d7c65604f2f9e6f7e241212b5328c6012ca4bbf205" {
		t.Fatalf("unexpected XDR digest: %s", source.XDRSHA256)
	}
	if len(source.FirstPreviousLedgerHash) != 64 || len(source.LastLedgerHash) != 64 {
		t.Fatalf("incomplete ledger chain boundary evidence: %+v", source)
	}

	manifestPath := checkedStoragePath(t, root, receipt.ManifestStorageKey)
	if digestPath(t, manifestPath) != receipt.ManifestSHA256 {
		t.Fatalf("manifest digest mismatch")
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if manifest.ManifestVersion != "stellar-atlas.full-history-etl.manifest.v8" {
		t.Fatalf("unexpected manifest version: %s", manifest.ManifestVersion)
	}
	for _, descriptor := range manifest.Outputs {
		switch descriptor.Dataset {
		case "contract-events":
			if descriptor.SchemaVersion != "stellar-atlas.full-history.contract-events.v3" {
				t.Fatalf("contract event projection is not schema v3: %s", descriptor.SchemaVersion)
			}
		case "ledger-entry-changes":
			if descriptor.SchemaVersion != "stellar-atlas.full-history.ledger-entry-changes.v3" {
				t.Fatalf("ledger entry change projection is not schema v3: %s", descriptor.SchemaVersion)
			}
		case "account-state-changes":
			if descriptor.SchemaVersion != "stellar-atlas.full-history.account-state-changes.v1" {
				t.Fatalf("account state change projection is not schema v1: %s", descriptor.SchemaVersion)
			}
		case "trustline-state-changes":
			if descriptor.SchemaVersion != "stellar-atlas.full-history.trustline-state-changes.v1" {
				t.Fatalf("trustline state change projection is not schema v1: %s", descriptor.SchemaVersion)
			}
		}
	}
	wantUnsupported := []string{
		"ledger-close-upgrades-and-extension-values",
		"transaction-envelope-details",
		"operation-result-details",
		"effects",
		"account-current-state-and-signers",
		"assets",
		"trustline-current-state",
		"offers",
		"liquidity-pools",
		"contracts",
		"contract-data-values",
		"contract-code-values",
		"operation-type-details",
		"transaction-meta-values",
		"ttl-entries",
		"config-settings",
		"restored-keys",
	}
	if !reflect.DeepEqual(manifest.Unsupported, wantUnsupported) {
		t.Fatalf("unexpected unsupported datasets: %v", manifest.Unsupported)
	}
	if !reflect.DeepEqual(manifest.Outputs, receipt.Outputs) || !reflect.DeepEqual(manifest.SourceObjects, receipt.SourceObjects) || manifest.Range != receipt.Range {
		t.Fatalf("receipt does not map directly to stored manifest")
	}
	receiptBytes, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	for name, encoded := range map[string][]byte{"manifest": manifestBytes, "receipt": receiptBytes} {
		if !bytes.Contains(encoded, []byte(`"sourceObjects"`)) || bytes.Contains(encoded, []byte(`"sources"`)) {
			t.Fatalf("%s does not use the sourceObjects JSON contract", name)
		}
	}
	assertPublishedFileSet(t, outputDirectory, len(wantCounts)+1)

	replayed, err := Run(context.Background(), fixtureConfig(root, outputDirectory))
	if err != nil {
		t.Fatalf("recover exact replay: %v", err)
	}
	if !reflect.DeepEqual(receipt, replayed) {
		t.Fatalf("replay receipt changed:\nfirst:  %+v\nreplay: %+v", receipt, replayed)
	}
	manifestAfterReplay, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(manifestBytes, manifestAfterReplay) {
		t.Fatal("exact replay rewrote the manifest")
	}
}

func TestRunRejectsConflictingExistingOutputWithoutDeletingIt(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	config := fixtureConfig(root, outputDirectory)
	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("initial Run: %v", err)
	}
	ledgerPath := checkedStoragePath(t, root, receipt.Outputs[0].StorageKey)
	file, err := os.OpenFile(ledgerPath, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	changed := []byte{0}
	if _, err := file.ReadAt(changed, 8); err != nil {
		file.Close()
		t.Fatal(err)
	}
	changed[0] ^= 0xff
	if _, err := file.WriteAt(changed, 8); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	conflictingDigest := digestPath(t, ledgerPath)

	_, err = Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "conflicting existing output") || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("expected conflicting output digest error, got %v", err)
	}
	if digestPath(t, ledgerPath) != conflictingDigest {
		t.Fatal("conflicting output was overwritten")
	}
	if _, err := os.Stat(outputDirectory); err != nil {
		t.Fatalf("conflicting output directory was deleted: %v", err)
	}
}

func TestRunCleansStagingDirectoryOnTransformFailure(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "failed", "range=53312000-53312000")
	config := fixtureConfig(root, outputDirectory)
	config.NetworkPassphrase = "wrong network"

	_, err := Run(context.Background(), config)
	if err == nil {
		t.Fatal("expected transaction binding failure")
	}
	if _, statErr := os.Stat(outputDirectory); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("failed output was retained: %v", statErr)
	}
	entries, readErr := os.ReadDir(filepath.Dir(outputDirectory))
	if readErr != nil {
		t.Fatal(readErr)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("staging directory was retained: %s", entry.Name())
		}
	}
}

func TestRunDeletesPartiallyWrittenOutputOnRowLimit(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "partial", "range=53312000-53312000")
	config := fixtureConfig(root, outputDirectory)
	config.MaxRows = 1

	_, err := Run(context.Background(), config)
	if err == nil || !strings.Contains(err.Error(), "row limit") {
		t.Fatalf("expected row limit failure, got %v", err)
	}
	if _, statErr := os.Stat(outputDirectory); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("partially written output was retained: %v", statErr)
	}
	assertNoStagingDirectories(t, filepath.Dir(outputDirectory))
}

func TestRunRejectsOutputParentSymlinkWithoutEscapingRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "typed")
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(root, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	outputDirectory := filepath.Join(root, "escape", "created", "batch")

	_, err := Run(context.Background(), fixtureConfig(root, outputDirectory))
	if err == nil || !strings.Contains(err.Error(), "not a regular directory") {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(outside, "created")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("output parent escaped typed root: %v", statErr)
	}
}

func TestConfigRejectsOutputOutsideTypedRoot(t *testing.T) {
	root := t.TempDir()
	config := fixtureConfig(root, filepath.Join(filepath.Dir(root), "outside"))
	if err := config.Validate(); err == nil || !strings.Contains(err.Error(), "strict child") {
		t.Fatalf("expected typed output root error, got %v", err)
	}
}

func fixtureConfig(root, outputDirectory string) Config {
	return Config{
		Sources: []Source{{
			Path:      filepath.Join("..", "testdata", "FCD285FF--53312000.xdr.zstd"),
			ObjectKey: "pubnet/ledger/53312000.xdr.zstd",
		}},
		TypedOutputRoot:       root,
		OutputPath:            outputDirectory,
		NetworkName:           "pubnet",
		NetworkPassphrase:     publicNetworkPassphrase,
		StartLedger:           53312000,
		EndLedger:             53312000,
		MaxCompressedBytes:    1 << 20,
		MaxUncompressedBytes:  64 << 20,
		MaxDecodedMemoryBytes: 64 << 20,
		MaxOutputBytes:        128 << 20,
		MaxLedgers:            1,
		MaxRows:               10_000,
	}
}

func checkedStoragePath(t *testing.T, root, storageKey string) string {
	t.Helper()
	if storageKey == "" || path.IsAbs(storageKey) || path.Clean(storageKey) != storageKey || storageKey == ".." || strings.HasPrefix(storageKey, "../") {
		t.Fatalf("storage key is not a clean relative path: %q", storageKey)
	}
	localPath := filepath.Join(root, filepath.FromSlash(storageKey))
	relative, err := filepath.Rel(root, localPath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		t.Fatalf("storage key escapes typed output root: %q", storageKey)
	}
	return localPath
}

func digestPath(t *testing.T, filePath string) string {
	t.Helper()
	file, err := os.Open(filePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func assertParquetRows(t *testing.T, filePath string, want uint64) {
	t.Helper()
	file, err := local.NewLocalFileReader(filePath)
	if err != nil {
		t.Fatalf("open parquet %s: %v", filePath, err)
	}
	reader, err := reader.NewParquetReader(file, nil, 1)
	if err != nil {
		file.Close()
		t.Fatalf("read parquet %s: %v", filePath, err)
	}
	if got := reader.GetNumRows(); got != int64(want) {
		t.Errorf("parquet %s has %d rows, expected %d", filePath, got, want)
	}
	reader.ReadStop()
	if err := file.Close(); err != nil {
		t.Fatalf("close parquet %s: %v", filePath, err)
	}
}

func assertCanonicalLedgerCloseMeta(t *testing.T, filePath string, sources []SourceEvidence) {
	t.Helper()
	file, err := os.Open(filePath)
	if err != nil {
		t.Fatal(err)
	}
	decoder, err := zstd.NewReader(file, zstd.WithDecoderConcurrency(1))
	if err != nil {
		file.Close()
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(decoder)
	decoder.Close()
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err != nil {
		t.Fatalf("read canonical LedgerCloseMeta XDR: %v", err)
	}
	var batch xdr.LedgerCloseMetaBatch
	read, err := xdr.Unmarshal(bytes.NewReader(decoded), &batch)
	if err != nil {
		t.Fatalf("decode canonical LedgerCloseMeta batch: %v", err)
	}
	if read != len(decoded) {
		t.Fatalf("canonical LedgerCloseMeta batch has %d trailing bytes", len(decoded)-read)
	}
	if len(batch.LedgerCloseMetas) != len(sources) {
		t.Fatalf("canonical batch has %d ledgers, expected %d", len(batch.LedgerCloseMetas), len(sources))
	}
	for index, source := range sources {
		meta := batch.LedgerCloseMetas[index]
		individual := xdr.LedgerCloseMetaBatch{
			StartSequence: xdr.Uint32(source.StartLedger), EndSequence: xdr.Uint32(source.EndLedger),
			LedgerCloseMetas: []xdr.LedgerCloseMeta{meta},
		}
		var encoded bytes.Buffer
		if _, err := xdr.Marshal(&encoded, individual); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(encoded.Bytes())
		if hex.EncodeToString(digest[:]) != source.XDRSHA256 {
			t.Fatalf("canonical ledger %d does not reconstruct source XDR", source.StartLedger)
		}
	}
}

func assertPublishedFileSet(t *testing.T, outputDirectory string, wantFiles int) {
	t.Helper()
	files := 0
	err := filepath.WalkDir(outputDirectory, func(filePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type().IsRegular() {
			files++
			if strings.HasSuffix(entry.Name(), ".xdr") || strings.HasSuffix(entry.Name(), ".zstd") {
				t.Errorf("source payload was persisted: %s", filePath)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if files != wantFiles {
		t.Fatalf("published %d files, expected %d", files, wantFiles)
	}
}

func assertNoStagingDirectories(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("staging directory was retained: %s", entry.Name())
		}
	}
}
