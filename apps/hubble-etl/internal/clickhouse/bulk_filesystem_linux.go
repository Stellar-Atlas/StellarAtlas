//go:build linux

package clickhouse

import (
	"fmt"
	"math"

	"golang.org/x/sys/unix"
)

func readBulkFilesystemCapacity(path string) (bulkFilesystemCapacity, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return bulkFilesystemCapacity{}, fmt.Errorf("cannot open historical bulk capacity path: %w", err)
	}
	defer unix.Close(fd)
	var info unix.Stat_t
	var stats unix.Statfs_t
	if err := unix.Fstat(fd, &info); err != nil || info.Mode&unix.S_IFMT != unix.S_IFDIR {
		return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk capacity path must be a local directory")
	}
	if err := unix.Fstatfs(fd, &stats); err != nil || stats.Frsize <= 0 || stats.Blocks == 0 || stats.Bavail > stats.Blocks ||
		stats.Blocks > math.MaxUint64/uint64(stats.Frsize) {
		return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk filesystem capacity is unavailable")
	}
	return bulkFilesystemCapacity{
		device:    uint64(info.Dev),
		total:     stats.Blocks * uint64(stats.Frsize),
		available: stats.Bavail * uint64(stats.Frsize),
	}, nil
}
