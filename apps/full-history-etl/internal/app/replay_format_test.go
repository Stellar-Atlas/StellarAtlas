package app

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRunRecoversLegacySDKQualifiedProjections(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "typed-shard")
	config := fixtureConfig(root, directory)
	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := checkedStoragePath(t, root, receipt.ManifestStorageKey)
	manifest := readTypedManifest(t, manifestPath)
	manifest.Format.StellarSDK = "github.com/stellar/go-stellar-sdk@v0.6.0"
	manifest.Format.StellarXDRCommit = "68fa1ac55692f68ad2a2ca549d0a283273554439"
	if err := os.Remove(manifestPath); err != nil {
		t.Fatal(err)
	}
	if err := writeManifest(directory, manifest); err != nil {
		t.Fatal(err)
	}
	for _, descriptor := range manifest.Outputs {
		if descriptor.Representation == "typed-projection" {
			if err := os.Remove(checkedStoragePath(t, root, descriptor.StorageKey)); err != nil {
				t.Fatal(err)
			}
		}
	}
	recovered, err := Run(context.Background(), config)
	if err != nil || !reflect.DeepEqual(recovered.Outputs, manifest.Outputs) {
		t.Fatalf("legacy qualified recovery changed descriptors: %v", err)
	}
	if got := readTypedManifest(t, manifestPath); !reflect.DeepEqual(got, manifest) {
		t.Fatal("legacy recovery rewrote the original manifest")
	}
	for _, descriptor := range manifest.Outputs {
		if descriptor.Dataset == "account-state-changes" {
			path := checkedStoragePath(t, root, descriptor.StorageKey)
			if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), config); err == nil {
				t.Fatal("accepted a present but corrupt legacy state projection")
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, schema := range []string{"stellar-atlas.full-history.ledger-entry-changes.v2", "stellar-atlas.full-history.ledger-entry-changes.v4"} {
		if compatibleReplayFormat(manifest.Format, "ledger-entry-changes", schema) {
			t.Fatalf("accepted unqualified legacy schema %s", schema)
		}
	}
	manifest.Format.StellarXDRCommit = writerFormat().StellarXDRCommit
	if compatibleReplayFormat(manifest.Format, "transactions", "stellar-atlas.full-history.transactions.v2") ||
		compatibleReplayFormat(manifest.Format, "ledger-entry-changes", "stellar-atlas.full-history.ledger-entry-changes.v3") {
		t.Fatal("accepted a mismatched historical SDK/XDR pair")
	}
}

func TestLegacyQualifiedProjectionsRequireExactSchema(t *testing.T) {
	legacy := writerFormat()
	legacy.StellarSDK = "github.com/stellar/go-stellar-sdk@v0.6.0"
	legacy.StellarXDRCommit = "68fa1ac55692f68ad2a2ca549d0a283273554439"
	for _, item := range [][2]string{{"transactions", "v2"}, {"transaction-results", "v2"}, {"operations", "v2"}, {"ledger-entry-changes", "v3"}, {"ledgers", "v2"}, {"transaction-meta", "v2"}, {"contract-events", "v3"}, {"account-state-changes", "v1"}, {"trustline-state-changes", "v1"}} {
		dataset, version := item[0], item[1]
		schema := "stellar-atlas.full-history." + dataset + "." + version
		if !compatibleReplayFormat(legacy, dataset, schema) ||
			compatibleReplayFormat(legacy, dataset, schema+"0") {
			t.Fatalf("invalid verification/retry boundary for %s", schema)
		}
	}
	if compatibleReplayFormat(legacy, "contract-events", "stellar-atlas.full-history.contract-events.v2") ||
		compatibleReplayFormat(legacy, "ledgers", "stellar-atlas.full-history.transaction-meta.v2") {
		t.Fatal("accepted a different event version or family with the same version")
	}
	legacy.StellarXDRCommit = writerFormat().StellarXDRCommit
	if compatibleReplayFormat(legacy, "ledgers", "stellar-atlas.full-history.ledgers.v2") {
		t.Fatal("mixed SDK and XDR versions")
	}
}
