package app

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// checkCurrentBulkCommitBudget runs under the publication lock, before creating
// the publication copy on the source volume. The resolved parent may be on a
// different mount from the configured typed output root.
func checkCurrentBulkCommitBudget(stage, parent string) error {
	var staged unix.Stat_t
	if err := unix.Stat(stage, &staged); err != nil {
		return fmt.Errorf("current bulk commit guard: stat publication stage: %w", err)
	}
	if staged.Mode&unix.S_IFMT != unix.S_IFDIR {
		return fmt.Errorf("current bulk commit guard: publication stage is not a directory")
	}
	fd, err := unix.Open(parent, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("current bulk commit guard: open resolved output parent: %w", err)
	}
	defer unix.Close(fd)
	var destination unix.Stat_t
	if err := unix.Fstat(fd, &destination); err != nil {
		return fmt.Errorf("current bulk commit guard: stat resolved output parent: %w", err)
	}
	if staged.Dev == destination.Dev {
		return fmt.Errorf("current bulk commit guard: publication stage and resolved output parent are on the same filesystem device")
	}
	var fs unix.Statfs_t
	if err := unix.Fstatfs(fd, &fs); err != nil {
		return fmt.Errorf("current bulk commit guard: query source filesystem at resolved output parent: %w", err)
	}
	available, required, err := currentBulkSourceHeadroom(int64(fs.Bsize), fs.Blocks, fs.Bfree, fs.Bavail)
	if err != nil {
		return fmt.Errorf("current bulk commit guard: %w", err)
	}
	if available < required {
		return fmt.Errorf("current bulk commit guard: source filesystem has %d available bytes at resolved output parent %q; need at least %d bytes for the 5%% reserve, 32 GiB cushion, 8 GiB output cap, and 16 MiB metadata allowance", available, parent, required)
	}
	return nil
}
