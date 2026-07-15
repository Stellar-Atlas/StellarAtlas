package stateexport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"sync"

	"github.com/xitongsys/parquet-go/source"
)

const sourceHashBufferBytes = 128 << 10

type parquetFileGroup struct {
	mu           sync.Mutex
	path         string
	file         *os.File
	identity     os.FileInfo
	size         int64
	sourceSHA256 string
	views        map[*parquetLocalFile]struct{}
}

type parquetLocalFile struct {
	mu     sync.Mutex
	group  *parquetFileGroup
	file   *os.File
	size   int64
	offset int64
	closed bool
}

func newParquetFileGroup(path string) *parquetFileGroup {
	return &parquetFileGroup{path: path, views: make(map[*parquetLocalFile]struct{})}
}

func (g *parquetFileGroup) open(ctx context.Context) (*parquetLocalFile, string, error) {
	file, err := os.Open(g.path)
	if err != nil {
		return nil, "", err
	}
	info, err := file.Stat()
	if err != nil {
		return nil, "", errors.Join(err, file.Close())
	}
	if !info.Mode().IsRegular() {
		return nil, "", errors.Join(fmt.Errorf("input is not a regular file"), file.Close())
	}
	digest, err := hashFile(ctx, file, info.Size())
	if err != nil {
		return nil, "", errors.Join(fmt.Errorf("hash input: %w", err), file.Close())
	}
	afterHash, err := file.Stat()
	if err != nil {
		return nil, "", errors.Join(err, file.Close())
	}
	if !sameSourceSnapshot(info, afterHash) {
		return nil, "", errors.Join(fmt.Errorf("input changed while being hashed"), file.Close())
	}
	pathInfo, err := os.Stat(g.path)
	if err != nil {
		return nil, "", errors.Join(fmt.Errorf("stat input path after hashing: %w", err), file.Close())
	}
	if !os.SameFile(info, pathInfo) {
		return nil, "", errors.Join(fmt.Errorf("input path was replaced while being hashed"), file.Close())
	}
	if !sameSourceSnapshot(info, pathInfo) {
		return nil, "", errors.Join(fmt.Errorf("input changed while being hashed"), file.Close())
	}

	g.file = file
	g.identity = info
	g.size = info.Size()
	g.sourceSHA256 = digest
	view, err := g.newView()
	if err != nil {
		return nil, "", errors.Join(err, file.Close())
	}
	return view, digest, nil
}

func (g *parquetFileGroup) verifyUnchanged(ctx context.Context) error {
	pathInfo, err := os.Stat(g.path)
	if err != nil {
		return fmt.Errorf("input path changed while being exported: %w", err)
	}
	if !os.SameFile(g.identity, pathInfo) {
		return fmt.Errorf("input path was replaced while being exported")
	}
	beforeHash, err := g.file.Stat()
	if err != nil {
		return fmt.Errorf("stat opened input: %w", err)
	}
	if !sameSourceSnapshot(g.identity, beforeHash) {
		return fmt.Errorf("input changed while being exported")
	}
	digest, err := hashFile(ctx, g.file, g.size)
	if err != nil {
		return fmt.Errorf("rehash opened input: %w", err)
	}
	afterHash, err := g.file.Stat()
	if err != nil {
		return fmt.Errorf("stat opened input after hashing: %w", err)
	}
	if !sameSourceSnapshot(g.identity, afterHash) || digest != g.sourceSHA256 {
		return fmt.Errorf("input changed while being exported")
	}
	pathInfo, err = os.Stat(g.path)
	if err != nil {
		return fmt.Errorf("input path changed while being exported: %w", err)
	}
	if !os.SameFile(g.identity, pathInfo) {
		return fmt.Errorf("input path was replaced while being exported")
	}
	if !sameSourceSnapshot(g.identity, pathInfo) {
		return fmt.Errorf("input changed while being exported")
	}
	return nil
}

func (g *parquetFileGroup) newView() (*parquetLocalFile, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.file == nil {
		return nil, fmt.Errorf("parquet input is closed")
	}
	view := &parquetLocalFile{group: g, file: g.file, size: g.size}
	g.views[view] = struct{}{}
	return view, nil
}

func (g *parquetFileGroup) closeAll() error {
	g.mu.Lock()
	views := make([]*parquetLocalFile, 0, len(g.views))
	for view := range g.views {
		views = append(views, view)
	}
	g.views = make(map[*parquetLocalFile]struct{})
	file := g.file
	g.file = nil
	g.mu.Unlock()

	for _, view := range views {
		view.markClosed()
	}
	if file == nil {
		return nil
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close parquet input: %w", err)
	}
	return nil
}

func (g *parquetFileGroup) removeView(view *parquetLocalFile) {
	g.mu.Lock()
	delete(g.views, view)
	g.mu.Unlock()
}

func (f *parquetLocalFile) Open(name string) (source.ParquetFile, error) {
	if name != "" {
		return nil, fmt.Errorf("external parquet file references are not supported")
	}
	f.mu.Lock()
	closed := f.closed
	f.mu.Unlock()
	if closed {
		return nil, fmt.Errorf("parquet input view is closed")
	}
	return f.group.newView()
}

func (f *parquetLocalFile) Create(string) (source.ParquetFile, error) {
	return nil, fmt.Errorf("parquet input is read-only")
}

func (f *parquetLocalFile) Seek(offset int64, whence int) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return f.offset, os.ErrClosed
	}
	base := int64(0)
	switch whence {
	case io.SeekStart:
	case io.SeekCurrent:
		base = f.offset
	case io.SeekEnd:
		base = f.size
	default:
		return f.offset, fmt.Errorf("invalid seek whence %d", whence)
	}
	next, ok := addInt64(base, offset)
	if !ok || next < 0 {
		return f.offset, fmt.Errorf("invalid seek offset %d", offset)
	}
	f.offset = next
	return next, nil
}

func (f *parquetLocalFile) Read(data []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return 0, os.ErrClosed
	}
	if len(data) == 0 {
		return 0, nil
	}
	if f.offset >= f.size {
		return 0, io.EOF
	}
	requested := len(data)
	remaining := f.size - f.offset
	if int64(len(data)) > remaining {
		data = data[:int(remaining)]
	}
	read, err := f.file.ReadAt(data, f.offset)
	f.offset += int64(read)
	if err == nil && read < requested {
		err = io.EOF
	}
	return read, err
}

func (f *parquetLocalFile) Write([]byte) (int, error) {
	return 0, fmt.Errorf("parquet input is read-only")
}

func (f *parquetLocalFile) Close() error {
	if !f.markClosed() {
		return nil
	}
	f.group.removeView(f)
	return nil
}

func (f *parquetLocalFile) markClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.closed = true
	return true
}

func hashFile(ctx context.Context, file *os.File, size int64) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	hasher := sha256.New()
	buffer := make([]byte, sourceHashBufferBytes)
	for offset := int64(0); offset < size; {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		length := minInt64(size-offset, len(buffer))
		read, err := file.ReadAt(buffer[:int(length)], offset)
		if read > 0 {
			_, _ = hasher.Write(buffer[:read])
			offset += int64(read)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return "", io.ErrUnexpectedEOF
			}
			return "", err
		}
		if read == 0 {
			return "", io.ErrNoProgress
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func sameSourceSnapshot(expected, actual os.FileInfo) bool {
	return actual.Mode().IsRegular() &&
		os.SameFile(expected, actual) &&
		expected.Size() == actual.Size() &&
		expected.Mode() == actual.Mode() &&
		expected.ModTime().Equal(actual.ModTime()) &&
		sameSourceChangeTime(expected, actual)
}

func addInt64(left, right int64) (int64, bool) {
	if (right > 0 && left > math.MaxInt64-right) || (right < 0 && left < math.MinInt64-right) {
		return 0, false
	}
	return left + right, true
}

var _ source.ParquetFile = (*parquetLocalFile)(nil)
