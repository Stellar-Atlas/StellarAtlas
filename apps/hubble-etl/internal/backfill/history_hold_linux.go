//go:build linux

package backfill

import (
	"errors"
	"path"
	"strings"

	"golang.org/x/sys/unix"
)

// Only root-controlled directories on the existing /run tmpfs are accepted.
// Descriptor-relative, no-follow lookups avoid trusting a symlink or a replaced
// pathname. Marker contents are neither opened nor read.
func historyHoldMarkerReason(marker string) string {
	const unsafe = "historical hold control is unsafe or unavailable"
	if len(marker) > 512 || !strings.HasPrefix(marker, "/run/") ||
		path.Clean(marker) != marker || strings.ContainsRune(marker, '\x00') {
		return unsafe
	}
	parts := strings.Split(strings.TrimPrefix(marker, "/"), "/")
	if len(parts) < 3 || len(parts) > 8 {
		return unsafe
	}
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return unsafe
	}
	defer func() { _ = unix.Close(fd) }()
	for _, name := range parts[:len(parts)-1] {
		next, err := unix.Openat(fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
		if err != nil {
			return unsafe
		}
		_ = unix.Close(fd)
		fd = next
		var info unix.Stat_t
		var fs unix.Statfs_t
		if unix.Fstat(fd, &info) != nil || info.Uid != 0 ||
			info.Mode&unix.S_IFMT != unix.S_IFDIR || info.Mode&0o022 != 0 ||
			unix.Fstatfs(fd, &fs) != nil || fs.Type != unix.TMPFS_MAGIC {
			return unsafe
		}
	}
	var info unix.Stat_t
	err = unix.Fstatat(fd, parts[len(parts)-1], &info, unix.AT_SYMLINK_NOFOLLOW)
	if errors.Is(err, unix.ENOENT) {
		return ""
	}
	if err != nil || info.Uid != 0 || info.Mode&unix.S_IFMT != unix.S_IFREG ||
		info.Mode&0o022 != 0 || info.Nlink != 1 || info.Size > 4096 {
		return unsafe
	}
	return "historical admission hold requested"
}
