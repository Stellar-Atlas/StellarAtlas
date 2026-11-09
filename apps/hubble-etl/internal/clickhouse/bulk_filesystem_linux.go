//go:build linux

package clickhouse

import (
	"fmt"
	"math"

	"golang.org/x/sys/unix"
)

func readBulkFilesystemCapacity(path string) (bulkFilesystemCapacity, error) {
	return readBulkCapacityDirectory(path, 0)
}

func readBulkCapacityDirectory(path string, metadataInode uint64) (bulkFilesystemCapacity, error) {
	flags := unix.O_PATH | unix.O_DIRECTORY | unix.O_CLOEXEC
	if metadataInode != 0 {
		flags |= unix.O_NOFOLLOW
	}
	fd, err := unix.Open(path, flags, 0)
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
	if metadataInode != 0 {
		if info.Ino != metadataInode || stats.Flags&unix.ST_RDONLY == 0 {
			return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk metadata binding identity or read-only mount changed")
		}
		for _, access := range []uint32{unix.R_OK, unix.X_OK} {
			if unix.Faccessat2(fd, "", access, unix.AT_EMPTY_PATH|unix.AT_EACCESS) != unix.EACCES {
				return bulkFilesystemCapacity{}, fmt.Errorf("historical bulk metadata binding must deny directory reading and search")
			}
		}
	}
	return bulkFilesystemCapacity{
		device:    uint64(info.Dev),
		total:     stats.Blocks * uint64(stats.Frsize),
		available: stats.Bavail * uint64(stats.Frsize),
	}, nil
}
