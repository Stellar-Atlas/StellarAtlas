package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
)

const publicationCopyBufferBytes = 8 << 20

func validatePublicationStagingRoot(typedRoot, stagingRoot string) error {
	if stagingRoot == "" {
		return nil
	}
	if !filepath.IsAbs(stagingRoot) {
		return fmt.Errorf("publication staging root must be absolute")
	}
	cleanStaging := filepath.Clean(stagingRoot)
	if cleanStaging == string(filepath.Separator) {
		return fmt.Errorf("publication staging root must not be the filesystem root")
	}
	typedPath, err := filepath.Abs(typedRoot)
	if err != nil {
		return fmt.Errorf("resolve typed output root: %w", err)
	}
	if pathsOverlap(typedPath, cleanStaging) {
		return fmt.Errorf("publication staging and typed output roots must be disjoint")
	}
	return nil
}

func pathsOverlap(first, second string) bool {
	return pathContains(first, second) || pathContains(second, first)
}

func pathContains(parent, candidate string) bool {
	relative, err := filepath.Rel(parent, candidate)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !filepath.IsAbs(relative) &&
		!startsWithParent(relative))
}

func startsWithParent(relative string) bool {
	return len(relative) > 3 &&
		relative[:3] == ".."+string(filepath.Separator)
}

func preparePublicationStagingRoot(stagingRoot string) (string, error) {
	if err := os.MkdirAll(stagingRoot, 0o750); err != nil {
		return "", fmt.Errorf("create publication staging root: %w", err)
	}
	info, err := os.Lstat(stagingRoot)
	if err != nil {
		return "", fmt.Errorf("stat publication staging root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", fmt.Errorf("publication staging root is not a regular directory")
	}
	resolved, err := filepath.EvalSymlinks(stagingRoot)
	if err != nil {
		return "", fmt.Errorf("resolve publication staging root: %w", err)
	}
	return resolved, nil
}

func acquirePublicationLock(ctx context.Context, stagingRoot string) (*os.File, error) {
	lock, err := os.OpenFile(
		filepath.Join(stagingRoot, ".publish.lock"),
		os.O_CREATE|os.O_RDWR,
		0o600,
	)
	if err != nil {
		return nil, fmt.Errorf("open publication lock: %w", err)
	}
	for {
		err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return lock, nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EAGAIN) {
			_ = lock.Close()
			return nil, fmt.Errorf("acquire publication lock: %w", err)
		}
		select {
		case <-ctx.Done():
			_ = lock.Close()
			return nil, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func releasePublicationLock(lock *os.File) {
	_ = unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	_ = lock.Close()
}

func copyPublicationStage(
	ctx context.Context,
	source, parent, outputName string,
) (destination string, err error) {
	destination, err = os.MkdirTemp(parent, "."+outputName+".publish-")
	if err != nil {
		return "", fmt.Errorf("create publication copy directory: %w", err)
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(destination)
		}
	}()
	buffer := make([]byte, publicationCopyBufferBytes)
	if err := copyDirectoryContents(ctx, source, destination, buffer); err != nil {
		return "", err
	}
	if err := syncDirectory(destination); err != nil {
		return "", fmt.Errorf("sync publication copy directory: %w", err)
	}
	complete = true
	return destination, nil
}

func copyDirectoryContents(
	ctx context.Context,
	source, destination string,
	buffer []byte,
) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return fmt.Errorf("read publication staging directory: %w", err)
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		sourcePath := filepath.Join(source, entry.Name())
		destinationPath := filepath.Join(destination, entry.Name())
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat staged output %s: %w", entry.Name(), err)
		}
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			return fmt.Errorf("staged output contains symlink %s", entry.Name())
		case info.IsDir():
			if err := os.Mkdir(destinationPath, info.Mode().Perm()); err != nil {
				return fmt.Errorf("create publication directory %s: %w", entry.Name(), err)
			}
			if err := copyDirectoryContents(ctx, sourcePath, destinationPath, buffer); err != nil {
				return err
			}
			if err := syncDirectory(destinationPath); err != nil {
				return fmt.Errorf("sync publication directory %s: %w", entry.Name(), err)
			}
		case info.Mode().IsRegular():
			if err := copyRegularFile(ctx, sourcePath, destinationPath, info.Mode().Perm(), buffer); err != nil {
				return fmt.Errorf("copy staged output %s: %w", entry.Name(), err)
			}
		default:
			return fmt.Errorf("staged output is not a regular file or directory: %s", entry.Name())
		}
	}
	return nil
}

func copyRegularFile(
	ctx context.Context,
	sourcePath, destinationPath string,
	mode os.FileMode,
	buffer []byte,
) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	copyErr := copyWithContext(ctx, destination, source, buffer)
	if copyErr == nil {
		copyErr = destination.Sync()
	}
	closeErr := destination.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func copyWithContext(ctx context.Context, destination io.Writer, source io.Reader, buffer []byte) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			written, writeErr := destination.Write(buffer[:read])
			if writeErr != nil {
				return writeErr
			}
			if written != read {
				return io.ErrShortWrite
			}
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
