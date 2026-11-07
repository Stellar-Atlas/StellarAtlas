//go:build linux

package backfill

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestLinuxHistoryHoldControlMetadata(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root-owned runtime fixture requires root")
	}
	var fs unix.Statfs_t
	if err := unix.Statfs("/run", &fs); err != nil || fs.Type != unix.TMPFS_MAGIC {
		t.Skip("fixture requires an existing /run tmpfs")
	}
	root, err := os.MkdirTemp("/run", "atlas-history-hold-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	marker := filepath.Join(root, "hold")
	if got := historyHoldMarkerReason(marker); got != "" {
		t.Fatalf("missing marker in safe directory: %s", got)
	}
	if err := os.WriteFile(marker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := historyHoldMarkerReason(marker); got != "historical admission hold requested" {
		t.Fatalf("root-owned marker: %s", got)
	}
	if err := os.Chmod(marker, 0o666); err != nil {
		t.Fatal(err)
	}
	assertUnsafeHistoryMarker(t, marker)
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("missing-target", marker); err != nil {
		t.Fatal(err)
	}
	assertUnsafeHistoryMarker(t, marker)
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	// Metadata-only inspection must not open or block on a FIFO.
	if err := unix.Mkfifo(marker, 0o600); err != nil {
		t.Fatal(err)
	}
	assertUnsafeHistoryMarker(t, marker)
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o777); err != nil {
		t.Fatal(err)
	}
	assertUnsafeHistoryMarker(t, marker) // Even absence is unsafe in this directory.
	if err := os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(root, 1, 1); err != nil {
		t.Fatal(err)
	}
	assertUnsafeHistoryMarker(t, marker)
	for _, invalid := range []string{"/tmp/hold", "/run/a/../hold", "/run/a//hold", "/run/a/hold\x00"} {
		assertUnsafeHistoryMarker(t, invalid)
	}
}

func assertUnsafeHistoryMarker(t *testing.T, path string) {
	t.Helper()
	if got := historyHoldMarkerReason(path); got != "historical hold control is unsafe or unavailable" {
		t.Fatalf("unsafe control %q: %s", path, got)
	}
}
