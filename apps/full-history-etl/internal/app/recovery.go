package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
)

func recoverExistingOutput(
	config Config,
	evidence ShardEvidence,
	rootPath, outputPath, publishPath string,
) (ProcessingReceipt, error) {
	info, err := os.Lstat(publishPath)
	if err != nil {
		return ProcessingReceipt{}, fmt.Errorf("stat existing output: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return ProcessingReceipt{}, fmt.Errorf("existing output is not a regular directory")
	}
	storageDirectory, err := relativeStorageDirectory(rootPath, outputPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	manifestPath := filepath.Join(publishPath, manifestFilename)
	rawManifest, err := readManifest(manifestPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	manifest, err := decodeManifest(rawManifest)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	if err := validateRecoveredManifest(config, evidence, manifest, storageDirectory, publishPath); err != nil {
		return ProcessingReceipt{}, err
	}
	unchangedManifest, err := readManifest(manifestPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	if !bytes.Equal(rawManifest, unchangedManifest) {
		return ProcessingReceipt{}, fmt.Errorf("manifest changed during validation")
	}
	if err := syncDirectory(publishPath); err != nil {
		return ProcessingReceipt{}, fmt.Errorf("sync recovered output directory: %w", err)
	}
	if err := syncDirectory(filepath.Dir(publishPath)); err != nil {
		return ProcessingReceipt{}, fmt.Errorf("sync recovered output parent: %w", err)
	}
	digest := sha256.Sum256(rawManifest)
	return newReceipt(
		manifest,
		hex.EncodeToString(digest[:]),
		path.Join(storageDirectory, manifestFilename),
	), nil
}

func validateRecoveredManifest(
	config Config,
	evidence ShardEvidence,
	manifest Manifest,
	storageDirectory, publishPath string,
) error {
	expected := newManifest(config, evidence, nil)
	if manifest.ManifestVersion != manifestVersion {
		return fmt.Errorf("unsupported manifest version %q", manifest.ManifestVersion)
	}
	createdAt, err := time.Parse(time.RFC3339Nano, manifest.CreatedAt)
	if err != nil || createdAt.UTC().Format(time.RFC3339Nano) != manifest.CreatedAt {
		return fmt.Errorf("invalid manifest creation time %q", manifest.CreatedAt)
	}
	if manifest.Network != expected.Network {
		return fmt.Errorf("network does not match expected configuration")
	}
	if manifest.Range != evidence.Range {
		return fmt.Errorf("ledger range does not match decoded input")
	}
	if manifest.InputMediaType != inputMediaType {
		return fmt.Errorf("input media type does not match this transformer")
	}
	if !reflect.DeepEqual(manifest.SourceObjects, evidence.SourceObjects) {
		return fmt.Errorf("ordered source object evidence does not match decoded inputs")
	}
	if manifest.Limits != expected.Limits {
		return fmt.Errorf("processing limits do not match the existing typed shard")
	}
	if err := validateRecoveredLimits(manifest); err != nil {
		return err
	}
	if err := validateRecoveredSources(manifest); err != nil {
		return err
	}
	if !reflect.DeepEqual(manifest.Format, expected.Format) {
		return fmt.Errorf("typed output format does not match this transformer")
	}
	if !reflect.DeepEqual(manifest.Unsupported, expected.Unsupported) {
		return fmt.Errorf("unsupported dataset declaration does not match this transformer")
	}
	return validateRecoveredOutputs(manifest, storageDirectory, publishPath)
}

func validateRecoveredLimits(manifest Manifest) error {
	limits := manifest.Limits
	if limits.MaxCompressedBytes <= 0 || limits.MaxUncompressedBytes <= 0 ||
		limits.MaxDecodedMemoryBytes <= 0 || limits.MaxOutputBytes <= 0 ||
		limits.MaxLedgers == 0 || limits.MaxRows == 0 {
		return fmt.Errorf("manifest contains invalid processing limits")
	}
	if limits.MaxLedgers > hardMaxShardLedgers || manifest.Range.LedgerCount > limits.MaxLedgers {
		return fmt.Errorf("manifest ledger range exceeds its recorded processing limits")
	}
	if manifest.Range.StartLedger == 0 || manifest.Range.EndLedger < manifest.Range.StartLedger {
		return fmt.Errorf("manifest contains invalid aggregate ledger range")
	}
	expectedCount := uint64(manifest.Range.EndLedger) - uint64(manifest.Range.StartLedger) + 1
	if manifest.Range.LedgerCount != expectedCount {
		return fmt.Errorf("manifest ledger count does not match aggregate range")
	}
	return nil
}

func validateRecoveredSources(manifest Manifest) error {
	if len(manifest.SourceObjects) == 0 || len(manifest.SourceObjects) > hardMaxInputFiles {
		return fmt.Errorf("manifest source object count %d is outside [1,%d]", len(manifest.SourceObjects), hardMaxInputFiles)
	}
	expectedLedger := uint64(manifest.Range.StartLedger)
	var ledgerCount uint64
	var compressedBytes, xdrBytes int64
	var previousLedgerHash string
	seenObjectKeys := make(map[string]struct{}, len(manifest.SourceObjects))
	for index, source := range manifest.SourceObjects {
		if err := validateObjectKey(source.ObjectKey); err != nil {
			return fmt.Errorf("manifest source %d object key: %w", index, err)
		}
		if _, duplicate := seenObjectKeys[source.ObjectKey]; duplicate {
			return fmt.Errorf("manifest contains duplicate source object key %q", source.ObjectKey)
		}
		seenObjectKeys[source.ObjectKey] = struct{}{}
		if uint64(source.StartLedger) != expectedLedger || source.EndLedger < source.StartLedger {
			return fmt.Errorf("manifest source %d is not contiguous at ledger %d", index, expectedLedger)
		}
		if source.CompressedByteCount <= 0 || source.CompressedByteCount > manifest.Limits.MaxCompressedBytes-compressedBytes {
			return fmt.Errorf("manifest source %d exceeds compressed byte limit", index)
		}
		if source.XDRByteCount <= 0 || source.XDRByteCount > manifest.Limits.MaxUncompressedBytes-xdrBytes {
			return fmt.Errorf("manifest source %d exceeds XDR byte limit", index)
		}
		if err := validateSHA256(source.CompressedSHA256); err != nil {
			return fmt.Errorf("manifest source %d compressed digest: %w", index, err)
		}
		if err := validateSHA256(source.FirstPreviousLedgerHash); err != nil {
			return fmt.Errorf("manifest source %d first previous ledger hash: %w", index, err)
		}
		if err := validateSHA256(source.LastLedgerHash); err != nil {
			return fmt.Errorf("manifest source %d last ledger hash: %w", index, err)
		}
		if index > 0 && source.FirstPreviousLedgerHash != previousLedgerHash {
			return fmt.Errorf("manifest source %d does not link to the preceding source object", index)
		}
		if err := validateSHA256(source.XDRSHA256); err != nil {
			return fmt.Errorf("manifest source %d XDR digest: %w", index, err)
		}
		count := uint64(source.EndLedger) - uint64(source.StartLedger) + 1
		if source.LedgerCount != count {
			return fmt.Errorf("manifest source %d ledger count does not match its range", index)
		}
		if count > manifest.Limits.MaxLedgers-ledgerCount {
			return fmt.Errorf("manifest source %d exceeds ledger limit", index)
		}
		ledgerCount += count
		compressedBytes += source.CompressedByteCount
		xdrBytes += source.XDRByteCount
		expectedLedger = uint64(source.EndLedger) + 1
		previousLedgerHash = source.LastLedgerHash
	}
	if expectedLedger != uint64(manifest.Range.EndLedger)+1 || ledgerCount != manifest.Range.LedgerCount {
		return fmt.Errorf("manifest source evidence does not cover aggregate range")
	}
	return nil
}

func validateRecoveredOutputs(manifest Manifest, storageDirectory, publishPath string) error {
	specifications := output.Specifications()
	if len(manifest.Outputs) != len(specifications) {
		return fmt.Errorf("manifest has %d outputs, expected %d", len(manifest.Outputs), len(specifications))
	}
	expectedFiles := map[string]struct{}{manifestFilename: {}}
	var totalRows uint64
	var totalBytes int64
	var transactionCount *uint64
	for index, specification := range specifications {
		descriptor := manifest.Outputs[index]
		if descriptor.Dataset != specification.Dataset ||
			descriptor.MediaType != specification.MediaType ||
			descriptor.Representation != specification.Representation ||
			descriptor.SchemaVersion != specification.SchemaVersion {
			return fmt.Errorf("output %d does not match dataset specification %q", index, specification.Dataset)
		}
		expectedStorageKey := path.Join(storageDirectory, specification.Filename)
		if descriptor.StorageKey != expectedStorageKey {
			return fmt.Errorf("%s storage key does not match requested output directory", descriptor.Dataset)
		}
		if descriptor.ByteCount < 8 || descriptor.ByteCount > manifest.Limits.MaxOutputBytes-totalBytes {
			return fmt.Errorf("%s byte count exceeds recorded output limit", descriptor.Dataset)
		}
		totalBytes += descriptor.ByteCount
		if descriptor.RecordCount > manifest.Limits.MaxRows-totalRows {
			return fmt.Errorf("%s record count exceeds recorded row limit", descriptor.Dataset)
		}
		totalRows += descriptor.RecordCount
		if err := validateSHA256(descriptor.SHA256); err != nil {
			return fmt.Errorf("invalid %s digest: %w", descriptor.Dataset, err)
		}
		if (descriptor.Dataset == "ledger-close-meta" || descriptor.Dataset == "ledgers") &&
			descriptor.RecordCount != manifest.Range.LedgerCount {
			return fmt.Errorf("ledger output count does not match manifest range")
		}
		if descriptor.Dataset == "transactions" {
			count := descriptor.RecordCount
			transactionCount = &count
		}
		if (descriptor.Dataset == "transaction-results" || descriptor.Dataset == "transaction-meta") &&
			(transactionCount == nil || descriptor.RecordCount != *transactionCount) {
			return fmt.Errorf("%s count does not match transaction count", descriptor.Dataset)
		}
		if err := validateOutputFile(filepath.Join(publishPath, specification.Filename), descriptor); err != nil {
			return fmt.Errorf("validate %s: %w", descriptor.Dataset, err)
		}
		expectedFiles[specification.Filename] = struct{}{}
	}
	entries, err := os.ReadDir(publishPath)
	if err != nil {
		return fmt.Errorf("list existing output: %w", err)
	}
	if len(entries) != len(expectedFiles) {
		return fmt.Errorf("existing output contains %d entries, expected %d", len(entries), len(expectedFiles))
	}
	for _, entry := range entries {
		if _, expected := expectedFiles[entry.Name()]; !expected {
			return fmt.Errorf("existing output contains unexpected entry %q", entry.Name())
		}
	}
	return nil
}

func validateOutputFile(filePath string, descriptor output.Descriptor) error {
	info, err := os.Lstat(filePath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("output is not a regular file")
	}
	if info.Size() != descriptor.ByteCount {
		return fmt.Errorf("byte count is %d, manifest says %d", info.Size(), descriptor.ByteCount)
	}
	digest, err := hashFile(filePath)
	if err != nil {
		return err
	}
	if digest != descriptor.SHA256 {
		return fmt.Errorf("SHA-256 does not match manifest")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	magic := make([]byte, 4)
	switch descriptor.MediaType {
	case output.ParquetMediaType:
		if _, err := file.ReadAt(magic, 0); err != nil || !bytes.Equal(magic, []byte("PAR1")) {
			return fmt.Errorf("invalid Parquet header")
		}
		if _, err := file.ReadAt(magic, info.Size()-4); err != nil || !bytes.Equal(magic, []byte("PAR1")) {
			return fmt.Errorf("invalid Parquet footer")
		}
	case output.LedgerCloseMetaMediaType:
		if _, err := file.ReadAt(magic, 0); err != nil || !bytes.Equal(magic, []byte{0x28, 0xb5, 0x2f, 0xfd}) {
			return fmt.Errorf("invalid canonical LedgerCloseMeta Zstandard header")
		}
	default:
		return fmt.Errorf("unsupported output media type %q", descriptor.MediaType)
	}
	return nil
}

func readManifest(filePath string) ([]byte, error) {
	info, err := os.Lstat(filePath)
	if err != nil {
		return nil, fmt.Errorf("stat manifest: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("manifest is not a regular file")
	}
	if info.Size() <= 0 || info.Size() > maxManifestBytes {
		return nil, fmt.Errorf("manifest size %d is outside [1,%d]", info.Size(), maxManifestBytes)
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open manifest: %w", err)
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxManifestBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	if int64(len(raw)) != info.Size() {
		return nil, fmt.Errorf("manifest changed while being read")
	}
	return raw, nil
}

func decodeManifest(raw []byte) (Manifest, error) {
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return Manifest{}, fmt.Errorf("validate manifest JSON: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Manifest{}, fmt.Errorf("manifest contains trailing JSON")
	}
	return manifest, nil
}

func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var consume func() error
	consume = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			seen := make(map[string]struct{})
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return fmt.Errorf("object key is not a string")
				}
				if _, duplicate := seen[key]; duplicate {
					return fmt.Errorf("duplicate object key %q", key)
				}
				seen[key] = struct{}{}
				if err := consume(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := consume(); err != nil {
					return err
				}
			}
		default:
			return fmt.Errorf("unexpected JSON delimiter %q", delimiter)
		}
		_, err = decoder.Token()
		return err
	}
	if err := consume(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("trailing JSON value")
	}
	return nil
}

func validateSHA256(value string) error {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return fmt.Errorf("must be 64 lowercase hexadecimal characters")
	}
	if _, err := hex.DecodeString(value); err != nil {
		return fmt.Errorf("must be hexadecimal: %w", err)
	}
	return nil
}
