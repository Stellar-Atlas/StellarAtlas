package app

import (
	"io"
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
	config, err := ParseConfig([]string{
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
	}, io.Discard)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	if !reflect.DeepEqual(config.Sources, wantSources) {
		t.Fatalf("source order changed: %+v", config.Sources)
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
