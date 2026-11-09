//go:build linux

package clickhouse

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestHistoryStorageMetadataRejectsWritableAndSymlinkViews(t *testing.T) {
	root := t.TempDir()
	var info unix.Stat_t
	if err := unix.Stat(root, &info); err != nil {
		t.Fatal(err)
	}
	if _, err := readBulkFilesystemCapacity(root); err != nil {
		t.Fatalf("ordinary filesystem metadata was refused: %v", err)
	}
	if _, err := readBulkCapacityDirectory(root, info.Ino); err == nil {
		t.Fatal("a writable mount was accepted as a metadata binding")
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readBulkCapacityDirectory(link, info.Ino); err == nil {
		t.Fatal("a symlink was accepted as a metadata binding")
	}
}
