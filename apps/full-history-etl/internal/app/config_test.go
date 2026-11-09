package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseConfigPreservesRepeatedInputOrder(t *testing.T) {
	root := t.TempDir()
	wantSources := []Source{
		{Path: "/tmp/53312000.xdr.zstd", ObjectKey: "pubnet/ledger/53312000.xdr.zstd"},
		{Path: "/tmp/53312001.xdr.zstd", ObjectKey: "pubnet/ledger/53312001.xdr.zstd"},
	}
	args := []string{
		"--input", wantSources[0].Path,
		"--input", wantSources[1].Path,
		"--input-object-key", wantSources[0].ObjectKey,
		"--input-object-key", wantSources[1].ObjectKey,
		"--typed-output-root", root,
		"--output", filepath.Join(root, "range=53312000-53312001"),
		"--network", "pubnet",
		"--network-passphrase", publicNetworkPassphrase,
		"--start-ledger", "53312000",
		"--end-ledger", "53312001",
	}
	config, err := ParseConfig(args, io.Discard)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	if !reflect.DeepEqual(config.Sources, wantSources) {
		t.Fatalf("source order changed: %+v", config.Sources)
	}
	if config.CurrentBulkCommitGuard {
		t.Fatal("current bulk commit guard must default off")
	}
	guarded, err := ParseConfig(append(args, "--publication-staging-root", t.TempDir(), "--current-bulk-commit-guard"), io.Discard)
	if err != nil || !guarded.CurrentBulkCommitGuard {
		t.Fatalf("expected the native guard flag to opt in: config=%+v, err=%v", guarded, err)
	}
}

func TestParseConfigRequiresOneObjectKeyPerInput(t *testing.T) {
	root := t.TempDir()
	_, err := ParseConfig([]string{
		"--input", "/tmp/53312000.xdr.zstd",
		"--typed-output-root", root,
		"--output", filepath.Join(root, "range=53312000-53312000"),
		"--network", "pubnet",
		"--network-passphrase", publicNetworkPassphrase,
		"--start-ledger", "53312000",
		"--end-ledger", "53312000",
	}, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "input object keys") {
		t.Fatalf("expected input/object-key cardinality error, got %v", err)
	}
}

func TestCurrentBulkCommitGuardRejectsInvalidConfigBeforeCreatingOutputRoot(t *testing.T) {
	for _, tt := range []struct {
		name string
		edit func(*Config)
		want string
	}{
		{"no staging", func(c *Config) { c.PublicationStagingRoot = "" }, "requires a separate publication staging root"},
		{"overlapping staging", func(c *Config) { c.PublicationStagingRoot = c.TypedOutputRoot }, "roots must be disjoint"},
		{"129 ledgers", func(c *Config) { c.EndLedger = c.StartLedger + 128 }, "ledger count 129 exceeds 128"},
		{"more than 8 GiB", func(c *Config) { c.MaxOutputBytes = (8 << 30) + 1 }, "output byte limit 8589934593 exceeds 8589934592"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "typed")
			config := fixtureConfig(root, filepath.Join(root, "nested", "range"))
			config.PublicationStagingRoot = t.TempDir()
			config.CurrentBulkCommitGuard = true
			config.MaxLedgers = 129
			config.EndLedger = config.StartLedger + 127
			config.MaxOutputBytes = 8 << 30
			if err := config.Validate(); err != nil {
				t.Fatalf("valid boundary config: %v", err)
			}
			tt.edit(&config)
			if _, err := Run(context.Background(), config); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Run returned %v, want %q", err, tt.want)
			}
			if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("invalid config allocated the output root: %v", err)
			}
		})
	}
}
