package app

import (
	"io"
	"path/filepath"
	"strings"
	"testing"
)

func TestTransactionReconstructionConfigKeepsNormalDefaultsAndRejectsIngestionModes(t *testing.T) {
	root := t.TempDir()
	args := []string{"--input", filepath.Join(root, "canonical.xdr.zst"), "--input-object-key", "replay/canonical.xdr.zst",
		"--typed-output-root", root, "--output", filepath.Join(root, "new"), "--network", "pubnet",
		"--network-passphrase", publicNetworkPassphrase, "--start-ledger", "1", "--end-ledger", "1"}
	digest := strings.Repeat("a", 64)
	for _, flag := range [][]string{{"--expected-source-sha256", digest}, {"--expected-source-sha256=" + digest}} {
		config, err := ParseTransactionReconstructionConfig(append(append([]string{}, args...), flag...), io.Discard)
		if err != nil {
			t.Fatal(err)
		}
		if config.ExpectedSourceSHA256 != digest || config.Config.MaxRows != defaultMaxRows ||
			config.Config.MaxOutputBytes != defaultMaxOutputBytes || config.Config.MaxDecodedMemoryBytes != defaultMaxDecodedMemoryBytes {
			t.Fatal("offline parsing changed the normal finite defaults")
		}
	}
	for _, invalid := range [][]string{nil, {"--expected-source-sha256", "bad"},
		{"--expected-source-sha256", digest, "--expected-source-sha256=" + digest},
		{"--expected-source-sha256", digest, "--retirement-recovery", "authority.json"},
		{"--expected-source-sha256", digest, "--publication-staging-root", filepath.Join(root, "stage")},
		{"--expected-source-sha256", digest, "--current-bulk-commit-guard"},
		{"--expected-source-sha256", digest, "--compact-ledger-entry-changes"}} {
		if _, err := ParseTransactionReconstructionConfig(append(append([]string{}, args...), invalid...), io.Discard); err == nil {
			t.Fatalf("invalid reconstruction mode accepted: %v", invalid)
		}
	}
	if _, err := ParseConfig(append(args, "--expected-source-sha256", digest), io.Discard); err == nil {
		t.Fatal("normal ingestion CLI unexpectedly acquired an offline mode")
	}
}
