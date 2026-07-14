package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/transform"
	"golang.org/x/sys/unix"
)

func Run(ctx context.Context, config Config) (ProcessingReceipt, error) {
	if err := config.Validate(); err != nil {
		return ProcessingReceipt{}, err
	}
	if err := ctx.Err(); err != nil {
		return ProcessingReceipt{}, err
	}
	rootPath, outputPath, err := resolveOutputPaths(config.TypedOutputRoot, config.OutputPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	publishPath, parent, err := preparePublicationPaths(rootPath, outputPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	storageDirectory, err := relativeStorageDirectory(rootPath, outputPath)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	if _, err := os.Lstat(publishPath); err == nil {
		evidence, inspectErr := inspectSources(ctx, config)
		if inspectErr != nil {
			return ProcessingReceipt{}, inspectErr
		}
		receipt, recoveryErr := recoverExistingOutput(config, evidence, rootPath, outputPath, publishPath)
		if recoveryErr != nil {
			return ProcessingReceipt{}, fmt.Errorf("conflicting existing output at %s: %w", outputPath, recoveryErr)
		}
		return receipt, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return ProcessingReceipt{}, fmt.Errorf("stat output path: %w", err)
	}
	stage, err := os.MkdirTemp(parent, "."+filepath.Base(publishPath)+".tmp-")
	if err != nil {
		return ProcessingReceipt{}, fmt.Errorf("create output staging directory: %w", err)
	}
	published := false
	renamed := false
	defer func() {
		if !published {
			_ = os.RemoveAll(stage)
			if renamed {
				_ = os.RemoveAll(publishPath)
				_ = syncDirectory(parent)
			}
		}
	}()

	outputs, err := output.OpenCollection(stage, config.MaxOutputBytes, config.StartLedger, config.EndLedger)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	defer outputs.Abort()
	processor, err := transform.NewProcessor(outputs, config.NetworkPassphrase, config.MaxRows)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	evidence, err := processSources(ctx, config, processor)
	if err != nil {
		return ProcessingReceipt{}, err
	}
	descriptors, err := outputs.Finish()
	if err != nil {
		return ProcessingReceipt{}, err
	}
	for index := range descriptors {
		descriptors[index].StorageKey = path.Join(storageDirectory, descriptors[index].StorageKey)
	}
	manifest := newManifest(config, evidence, descriptors)
	if err := writeManifest(stage, manifest); err != nil {
		return ProcessingReceipt{}, err
	}
	manifestSHA256, err := hashFile(filepath.Join(stage, manifestFilename))
	if err != nil {
		return ProcessingReceipt{}, fmt.Errorf("hash manifest: %w", err)
	}
	receipt := newReceipt(manifest, manifestSHA256, path.Join(storageDirectory, manifestFilename))
	if err := syncDirectory(stage); err != nil {
		return ProcessingReceipt{}, fmt.Errorf("sync staging directory: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return ProcessingReceipt{}, err
	}
	if err := unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, publishPath, unix.RENAME_NOREPLACE); err != nil {
		if errors.Is(err, unix.EEXIST) {
			receipt, recoveryErr := recoverExistingOutput(config, evidence, rootPath, outputPath, publishPath)
			if recoveryErr != nil {
				return ProcessingReceipt{}, fmt.Errorf("conflicting concurrently published output at %s: %w", outputPath, recoveryErr)
			}
			return receipt, nil
		}
		return ProcessingReceipt{}, fmt.Errorf("atomically publish output: %w", err)
	}
	renamed = true
	if err := syncDirectory(parent); err != nil {
		return ProcessingReceipt{}, fmt.Errorf("sync output parent after publication: %w", err)
	}
	published = true
	return receipt, nil
}

func relativeStorageDirectory(rootPath, outputPath string) (string, error) {
	storageDirectory, err := filepath.Rel(rootPath, outputPath)
	if err != nil {
		return "", fmt.Errorf("resolve output storage key: %w", err)
	}
	storageDirectory = filepath.ToSlash(storageDirectory)
	if storageDirectory == "." || storageDirectory == ".." || strings.HasPrefix(storageDirectory, "../") || path.IsAbs(storageDirectory) {
		return "", fmt.Errorf("output storage key must be relative to typed output root")
	}
	return storageDirectory, nil
}

func preparePublicationPaths(rootPath, outputPath string) (publishPath, parent string, err error) {
	if err := os.MkdirAll(rootPath, 0o750); err != nil {
		return "", "", fmt.Errorf("create typed output root: %w", err)
	}
	outputParent := filepath.Dir(outputPath)
	if err := createOutputParent(rootPath, outputParent); err != nil {
		return "", "", err
	}
	resolvedRoot, err := filepath.EvalSymlinks(rootPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve typed output root symlinks: %w", err)
	}
	resolvedParent, err := filepath.EvalSymlinks(outputParent)
	if err != nil {
		return "", "", fmt.Errorf("resolve output parent symlinks: %w", err)
	}
	publishPath = filepath.Join(resolvedParent, filepath.Base(outputPath))
	relative, err := filepath.Rel(resolvedRoot, publishPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve publication path relative to typed output root: %w", err)
	}
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", "", fmt.Errorf("resolved output must be a strict child of typed output root")
	}
	return publishPath, resolvedParent, nil
}

func createOutputParent(rootPath, outputParent string) error {
	relative, err := filepath.Rel(rootPath, outputParent)
	if err != nil {
		return fmt.Errorf("resolve output parent: %w", err)
	}
	if relative == "." {
		return nil
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return fmt.Errorf("output parent must be under typed output root")
	}
	current := rootPath
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			if err := os.Mkdir(current, 0o750); err != nil && !errors.Is(err, os.ErrExist) {
				return fmt.Errorf("create output parent %s: %w", current, err)
			}
			info, err = os.Lstat(current)
		}
		if err != nil {
			return fmt.Errorf("stat output parent %s: %w", current, err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("output parent component is not a regular directory: %s", current)
		}
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
