package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/stellar/go-stellar-sdk/network"
	"golang.org/x/sys/unix"
)

type MaterializedOutput struct {
	Version   int    `json:"version"`
	Path      string `json:"path"`
	Device    string `json:"device"`
	Inode     string `json:"inode"`
	ByteCount string `json:"byteCount"`
	SHA256    string `json:"sha256"`
	Dataset   string `json:"dataset"`
	CacheHit  bool   `json:"cacheHit"`
}

// WithMaterializedOutput keeps the cache lock until the consumer has opened and
// fstat-matched its own file descriptor. Eviction can then unlink the cache name
// without changing the bytes already being streamed by that descriptor.
func WithMaterializedOutput(ctx context.Context, c MaterializationConfig, opened func(MaterializedOutput) error) error {
	if err := c.Validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	manifest, expected, err := materializationManifest(c)
	if err != nil {
		return err
	}
	// Each input has a 12-byte XDR header; the canonical export has only one.
	if err := validateRecoveredSources(manifest); err != nil {
		return err
	}
	expectedXdr := int64(12)
	for _, s := range manifest.SourceObjects {
		if s.XDRByteCount <= 12 || s.XDRByteCount-12 > c.Limits.MaxUncompressedBytes-expectedXdr {
			return fmt.Errorf("registered replay exceeds the streaming byte budget")
		}
		expectedXdr += s.XDRByteCount - 12
	}
	if err := prepareMaterializationCache(c.CacheRoot); err != nil {
		return err
	}
	lockContext, lockCancel := context.WithTimeout(ctx, time.Minute)
	lock, err := acquirePublicationLock(lockContext, c.CacheRoot)
	lockCancel()
	if err != nil {
		return err
	}
	defer releasePublicationLock(lock)
	if err := reserveMaterializationCache(c.CacheRoot, c.CacheMaxBytes, 0); err != nil {
		return err
	}
	// One content-bound leaf per requested family. Old triplet leaves remain
	// ordinary bounded cache entries; they cannot be mistaken for these.
	keyHash := sha256.Sum256([]byte(c.ExpectedManifestSHA256 + ":" + c.Dataset))
	key := hex.EncodeToString(keyHash[:]) + "-" + c.ExpectedSourceSHA256
	leaf := filepath.Join(c.CacheRoot, key)
	cacheHit := false
	if _, err := os.Lstat(leaf); err == nil {
		if err := validateMaterialization(ctx, leaf, manifest, expected, c.ExpectedSourceSHA256); err != nil {
			return fmt.Errorf("existing cache entry failed verification; preserve for inspection: %w", err)
		}
		cacheHit = true
	} else if !os.IsNotExist(err) {
		return err
	} else {
		budget, err := materializationAllocation(c.CacheRoot, expected)
		if err != nil {
			return err
		}
		if err := reserveMaterializationCache(c.CacheRoot, c.CacheMaxBytes, budget); err != nil {
			return err
		}
		scratch, err := os.MkdirTemp(c.CacheRoot, ".build-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(scratch) // Only this invocation's new private cache directory.
		config := Config{
			Sources:         []Source{{Path: c.CanonicalPath, ObjectKey: "materialization/canonical.xdr.zstd"}},
			TypedOutputRoot: scratch, OutputPath: filepath.Join(scratch, "output"),
			NetworkName: manifest.Network.Name, NetworkPassphrase: c.NetworkPassphrase,
			StartLedger: manifest.Range.StartLedger, EndLedger: manifest.Range.EndLedger,
			MaxCompressedBytes: c.Limits.MaxCompressedBytes, MaxUncompressedBytes: expectedXdr,
			MaxDecodedMemoryBytes: c.Limits.MaxDecodedMemoryBytes, MaxLedgers: manifest.Range.LedgerCount,
			MaxRows: max(1, expected[c.Dataset].RecordCount),
		}
		// A completed original manifest gives an exact output budget. A different
		// writer is never allowed to expand the cache or return different bytes.
		for _, descriptor := range expected {
			config.MaxOutputBytes += descriptor.ByteCount
		}
		if config.MaxOutputBytes > c.Limits.MaxOutputBytes {
			return fmt.Errorf("original projections exceed configured reconstruction output bound")
		}
		spec, err := materializationSpec(manifest.ManifestVersion, c.Dataset)
		if err != nil {
			return err
		}
		if _, err := runReconstruction(ctx, TransactionReconstructionConfig{
			Config: config, ExpectedSourceSHA256: c.ExpectedSourceSHA256,
		}, &spec); err != nil {
			return err
		}
		if err := validateMaterialization(ctx, config.OutputPath, manifest, expected, c.ExpectedSourceSHA256); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := unix.Renameat2(unix.AT_FDCWD, config.OutputPath, unix.AT_FDCWD, leaf, unix.RENAME_NOREPLACE); err != nil {
			return fmt.Errorf("publish verified cache entry without replacement: %w", err)
		}
		if err := syncDirectory(c.CacheRoot); err != nil {
			return err
		}
	}
	filename, err := materializedFilename(c.Dataset)
	if err != nil {
		return err
	}
	name := filepath.Join(leaf, filename)
	var st unix.Stat_t
	if err := unix.Lstat(name, &st); err != nil || st.Mode&unix.S_IFMT != unix.S_IFREG {
		return fmt.Errorf("materialized output is not a regular file")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Chtimes(leaf, time.Now(), time.Now()); err != nil {
		return err
	}
	return opened(MaterializedOutput{
		Version: 1, Path: name, Device: strconv.FormatUint(uint64(st.Dev), 10),
		Inode: strconv.FormatUint(st.Ino, 10), ByteCount: strconv.FormatInt(st.Size, 10),
		SHA256: expected[c.Dataset].SHA256, Dataset: c.Dataset, CacheHit: cacheHit,
	})
}

func materializationManifest(c MaterializationConfig) (Manifest, map[string]output.Descriptor, error) {
	var empty Manifest
	for _, name := range []string{c.CanonicalPath, c.ManifestPath} {
		resolved, err := filepath.EvalSymlinks(name)
		if err != nil || resolved != name {
			return empty, nil, fmt.Errorf("retained inputs must be existing non-symlink paths")
		}
	}
	raw, err := readManifest(c.ManifestPath)
	if err != nil {
		return empty, nil, err
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != c.ExpectedManifestSHA256 {
		return empty, nil, fmt.Errorf("original manifest digest mismatch")
	}
	manifest, err := decodeManifest(raw)
	if err != nil || !isSupportedManifestVersion(manifest.ManifestVersion) {
		return empty, nil, fmt.Errorf("unsupported original manifest")
	}
	if !reflect.DeepEqual(manifest.Format, writerFormat()) {
		return empty, nil, fmt.Errorf("original writer or replay encoding is not supported")
	}
	spec, err := materializationSpec(manifest.ManifestVersion, c.Dataset)
	if err != nil {
		return empty, nil, err
	}
	id := network.ID(c.NetworkPassphrase)
	if manifest.Network.NetworkIDSHA256 != hex.EncodeToString(id[:]) || validateRecoveredLimits(manifest) != nil ||
		manifest.Range.LedgerCount > c.Limits.MaxLedgers {
		return empty, nil, fmt.Errorf("original manifest network or range mismatch")
	}
	expected := make(map[string]output.Descriptor)
	canonical := false
	for _, d := range manifest.Outputs {
		if d.Dataset == "ledger-close-meta" {
			if canonical || d.SHA256 != c.ExpectedSourceSHA256 || d.ByteCount <= 0 || d.ByteCount > c.Limits.MaxCompressedBytes ||
				d.MediaType != output.LedgerCloseMetaMediaType || d.Representation != output.LosslessReplayRepresentation ||
				d.SchemaVersion != output.Specifications()[0].SchemaVersion || d.RecordCount != manifest.Range.LedgerCount {
				return empty, nil, fmt.Errorf("canonical descriptor mismatch")
			}
			canonical = true
		}
		if d.Dataset != c.Dataset {
			continue
		}
		if _, duplicate := expected[d.Dataset]; duplicate || d.ByteCount <= 0 ||
			!reconstructionSourceSHA256Pattern.MatchString(d.SHA256) ||
			d.ByteCount > c.Limits.MaxOutputBytes || d.RecordCount > c.Limits.MaxRows ||
			d.SchemaVersion != spec.SchemaVersion || d.Representation != spec.Representation || d.MediaType != spec.MediaType {
			return empty, nil, fmt.Errorf("invalid original projection descriptor")
		}
		expected[d.Dataset] = d
	}
	if !canonical || len(expected) != 1 {
		return empty, nil, fmt.Errorf("original manifest must bind canonical source and requested projection")
	}
	return manifest, expected, nil
}

func validateMaterialization(ctx context.Context, leaf string, original Manifest, expected map[string]output.Descriptor, source string) error {
	info, err := os.Lstat(leaf)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("cache entry must be an ordinary directory")
	}
	raw, err := readManifest(filepath.Join(leaf, reconstructionReceiptFilename))
	if err != nil {
		return err
	}
	var receipt TransactionReconstructionReceipt
	if err := json.Unmarshal(raw, &receipt); err != nil || receipt.ReceiptVersion != "stellar-atlas.full-history.transaction-reconstruction.v1" ||
		receipt.Purpose != "on-demand-projection" || receipt.CompleteDatasetSet ||
		receipt.Network != original.Network || receipt.Range != original.Range || len(receipt.Outputs) != 1 ||
		len(receipt.SourceObjects) != 1 || receipt.SourceObjects[0].CompressedSHA256 != source {
		return fmt.Errorf("reconstruction receipt identity mismatch")
	}
	seen := make(map[string]bool)
	for _, d := range receipt.Outputs {
		e, ok := expected[d.Dataset]
		if !ok || seen[d.Dataset] || d.SHA256 != e.SHA256 || d.ByteCount != e.ByteCount ||
			d.RecordCount != e.RecordCount || d.SchemaVersion != e.SchemaVersion ||
			d.MediaType != e.MediaType || d.Representation != e.Representation {
			return fmt.Errorf("reconstructed projection differs from original descriptor")
		}
		seen[d.Dataset] = true
		filename, err := materializedFilename(d.Dataset)
		if err != nil {
			return err
		}
		name := filepath.Join(leaf, filename)
		fd, err := unix.Open(name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
		if err != nil {
			return err
		}
		file := os.NewFile(uintptr(fd), name)
		st, statErr := file.Stat()
		if statErr != nil || !st.Mode().IsRegular() || st.Size() != e.ByteCount {
			_ = file.Close()
			return fmt.Errorf("reconstructed file type or size mismatch")
		}
		hash := sha256.New()
		copyErr := copyWithContext(ctx, hash, file, make([]byte, 64<<10))
		closeErr := file.Close()
		if statErr != nil || !st.Mode().IsRegular() || st.Size() != e.ByteCount || copyErr != nil || closeErr != nil ||
			hex.EncodeToString(hash.Sum(nil)) != e.SHA256 {
			return fmt.Errorf("reconstructed file digest or size mismatch")
		}
	}
	return nil
}

func materializedFilename(dataset string) (string, error) {
	for _, spec := range output.Specifications() {
		if spec.Dataset == dataset && output.SupportsProjection(spec) {
			return spec.Filename, nil
		}
	}
	return "", fmt.Errorf("unsupported materialized dataset")
}

func materializationSpec(version, dataset string) (output.Specification, error) {
	specs, err := outputSpecificationsForVersion(version)
	if err != nil {
		return output.Specification{}, err
	}
	for _, spec := range specs {
		if spec.Dataset == dataset && output.SupportsProjection(spec) {
			return spec, nil
		}
	}
	return output.Specification{}, fmt.Errorf("no exact writer for %s in %s", dataset, version)
}
