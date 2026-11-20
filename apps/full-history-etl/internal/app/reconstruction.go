package app

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/transform"
	"github.com/stellar/go-stellar-sdk/network"
	"golang.org/x/sys/unix"
)

const reconstructionReceiptFilename = "reconstruction.json"

// TransactionReconstructionReceipt is deliberately not a ProcessingReceipt or
// Manifest. Partial offline outputs cannot advertise a complete ingestion set.
type TransactionReconstructionReceipt struct {
	ReceiptVersion     string              `json:"receiptVersion"`
	Purpose            string              `json:"purpose"`
	CompleteDatasetSet bool                `json:"completeDatasetSet"`
	CreatedAt          string              `json:"createdAt"`
	Network            ManifestNetwork     `json:"network"`
	Range              ManifestRange       `json:"range"`
	SourceObjects      []SourceEvidence    `json:"sourceObjects"`
	Limits             ManifestLimits      `json:"limits"`
	Outputs            []output.Descriptor `json:"outputs"`
}

// RunTransactionReconstruction reads one existing canonical source and emits
// only its three transaction projections into a new, no-replace scratch leaf.
// It never registers a catalogue row, writes canonical replay or selects a
// production service. The source digest must match before any result appears.
// The caller owns the immutable input and private scratch-parent boundary;
// pathname checks are not a replacement for that concurrency/ownership fence.
func RunTransactionReconstruction(ctx context.Context, reconstruction TransactionReconstructionConfig) (TransactionReconstructionReceipt, error) {
	if err := reconstruction.Validate(); err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if err := ctx.Err(); err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	config := reconstruction.Config
	sourcePath := config.Sources[0].Path
	resolvedSource, err := filepath.EvalSymlinks(sourcePath)
	if err != nil || resolvedSource != filepath.Clean(sourcePath) {
		return TransactionReconstructionReceipt{}, fmt.Errorf("reconstruction source must be an existing non-symlink local file")
	}
	before, err := os.Lstat(sourcePath)
	if err != nil || !before.Mode().IsRegular() || before.Size() > config.MaxCompressedBytes {
		return TransactionReconstructionReceipt{}, fmt.Errorf("reconstruction source must be regular and within the compressed byte limit")
	}
	root, target, err := resolveOutputPaths(config.TypedOutputRoot, config.OutputPath)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	final, parent, err := preparePublicationPaths(root, target)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if _, err := os.Lstat(final); !errors.Is(err, os.ErrNotExist) {
		return TransactionReconstructionReceipt{}, fmt.Errorf("reconstruction requires a new output leaf; existing or uncertain output is preserved")
	}
	storageDirectory, err := relativeStorageDirectory(root, target)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	stage, err := os.MkdirTemp(parent, "."+filepath.Base(final)+".reconstruction-")
	if err != nil {
		return TransactionReconstructionReceipt{}, fmt.Errorf("create reconstruction scratch directory: %w", err)
	}
	renamed := false
	defer func() {
		// Only this invocation's new private scratch directory may be removed.
		// After rename, preserve an uncertain durable result for owner inspection.
		if !renamed {
			_ = os.RemoveAll(stage)
		}
	}()
	outputs, err := output.OpenTransactionReconstructionCollection(stage, config.MaxOutputBytes)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	defer outputs.Abort()
	processor, err := transform.NewTransactionReconstructionProcessor(outputs, config.NetworkPassphrase, config.MaxRows)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	evidence, err := processSources(ctx, config, processor)
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if len(evidence.SourceObjects) != 1 || evidence.SourceObjects[0].CompressedSHA256 != reconstruction.ExpectedSourceSHA256 {
		return TransactionReconstructionReceipt{}, fmt.Errorf("reconstruction source digest does not match the expected canonical digest")
	}
	after, err := os.Lstat(sourcePath)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return TransactionReconstructionReceipt{}, fmt.Errorf("reconstruction source identity changed; no result published")
	}
	descriptors, err := outputs.Finish()
	if err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	for index := range descriptors {
		descriptors[index].StorageKey = path.Join(storageDirectory, descriptors[index].StorageKey)
	}
	networkID := network.ID(config.NetworkPassphrase)
	receipt := TransactionReconstructionReceipt{
		ReceiptVersion: "stellar-atlas.full-history.transaction-reconstruction.v1",
		Purpose:        "offline-transaction-reconstruction", CompleteDatasetSet: false,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Network:   ManifestNetwork{Name: config.NetworkName, NetworkIDSHA256: hex.EncodeToString(networkID[:])},
		Range:     evidence.Range, SourceObjects: evidence.SourceObjects, Outputs: descriptors,
		Limits: ManifestLimits{
			MaxCompressedBytes: config.MaxCompressedBytes, MaxUncompressedBytes: config.MaxUncompressedBytes,
			MaxDecodedMemoryBytes: config.MaxDecodedMemoryBytes, MaxOutputBytes: config.MaxOutputBytes,
			MaxLedgers: config.MaxLedgers, MaxRows: config.MaxRows,
		},
	}
	if err := writeReconstructionReceipt(stage, receipt); err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if err := syncDirectory(stage); err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if err := ctx.Err(); err != nil {
		return TransactionReconstructionReceipt{}, err
	}
	if err := unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, final, unix.RENAME_NOREPLACE); err != nil {
		return TransactionReconstructionReceipt{}, fmt.Errorf("publish new reconstruction leaf without replacement: %w", err)
	}
	renamed = true
	if err := syncDirectory(parent); err != nil {
		return TransactionReconstructionReceipt{}, fmt.Errorf("sync reconstruction parent; preserve result for inspection: %w", err)
	}
	return receipt, nil
}

func writeReconstructionReceipt(directory string, receipt TransactionReconstructionReceipt) error {
	encoded, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if len(encoded) > 1<<20 {
		return fmt.Errorf("reconstruction receipt exceeds one MiB")
	}
	file, err := os.OpenFile(filepath.Join(directory, reconstructionReceiptFilename), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(encoded)
	syncErr := file.Sync()
	closeErr := file.Close()
	return errors.Join(writeErr, syncErr, closeErr)
}
