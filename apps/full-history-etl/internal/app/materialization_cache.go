package app

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"golang.org/x/sys/unix"
)

var materializationCacheName = regexp.MustCompile(`^[0-9a-f]{64}-[0-9a-f]{64}$`)
var materializationScratchName = regexp.MustCompile(`^\.build-[0-9]+$`)

func prepareMaterializationCache(root string) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return fmt.Errorf("cache root must not contain symlinks")
	}
	var st unix.Stat_t
	if err := unix.Lstat(root, &st); err != nil || st.Mode&unix.S_IFMT != unix.S_IFDIR ||
		st.Mode&0o077 != 0 || st.Uid != uint32(os.Geteuid()) {
		return fmt.Errorf("cache must be a private directory owned by the service")
	}
	lock := filepath.Join(root, ".publish.lock")
	if err := unix.Lstat(lock, &st); err == nil {
		if st.Mode&unix.S_IFMT != unix.S_IFREG || st.Nlink != 1 || st.Uid != uint32(os.Geteuid()) || st.Mode&0o077 != 0 {
			return fmt.Errorf("cache lock has an unexpected identity")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	return nil
}

func materializationAllocation(root string, outputs map[string]output.Descriptor) (uint64, error) {
	var fs unix.Statfs_t
	if err := unix.Statfs(root, &fs); err != nil || fs.Bsize <= 0 {
		return 0, fmt.Errorf("cannot measure cache filesystem")
	}
	unit := uint64(fs.Bsize)
	bytes := uint64(1<<20) + 4*unit // Receipt maximum and private scratch directories.
	for _, d := range outputs {
		size := uint64(d.ByteCount)
		padding := (unit - size%unit) % unit
		if size > math.MaxUint64-padding || bytes > math.MaxUint64-size-padding {
			return 0, fmt.Errorf("cache allocation overflow")
		}
		bytes += size + padding
	}
	return bytes, nil
}

// Called only under the exclusive cache lock. No production directory or
// retained source is enumerated; unknown names refuse cleanup rather than
// extending deletion authority. A crashed helper's owned scratch is reusable.
func reserveMaterializationCache(root string, maximum, incoming uint64) error {
	var fs unix.Statfs_t
	if err := unix.Statfs(root, &fs); err != nil || fs.Bsize <= 0 {
		return fmt.Errorf("cannot measure cache filesystem")
	}
	unit := uint64(fs.Bsize)
	const rootAllowance = uint64(64 << 10)
	if maximum < rootAllowance || incoming > maximum-rootAllowance {
		return fmt.Errorf("reconstruction does not fit the configured cache bound")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	type cached struct {
		path  string
		bytes uint64
		at    time.Time
	}
	var retained []cached
	used := rootAllowance
	for _, entry := range entries {
		if entry.Name() == ".publish.lock" {
			continue
		}
		name := filepath.Join(root, entry.Name())
		info, err := entry.Info()
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
			(!materializationCacheName.MatchString(entry.Name()) && !materializationScratchName.MatchString(entry.Name())) {
			return fmt.Errorf("unknown object in dedicated materialization cache")
		}
		bytes, err := currentBulkPublicationBytes(name, unit)
		if err != nil {
			return err
		}
		if materializationScratchName.MatchString(entry.Name()) {
			if err := os.RemoveAll(name); err != nil {
				return err
			}
			continue
		}
		if used > math.MaxUint64-bytes {
			return fmt.Errorf("cache inventory overflow")
		}
		used += bytes
		retained = append(retained, cached{name, bytes, info.ModTime()})
	}
	sort.Slice(retained, func(i, j int) bool { return retained[i].at.Before(retained[j].at) })
	for _, entry := range retained {
		if used <= maximum-incoming {
			break
		}
		if err := os.RemoveAll(entry.path); err != nil {
			return err
		}
		used -= entry.bytes
	}
	if err := unix.Statfs(root, &fs); err != nil || fs.Bsize <= 0 ||
		fs.Bavail > math.MaxUint64/uint64(fs.Bsize) || fs.Bavail*uint64(fs.Bsize) < incoming {
		return fmt.Errorf("cache filesystem lacks space for the measured reconstruction")
	}
	return nil
}
