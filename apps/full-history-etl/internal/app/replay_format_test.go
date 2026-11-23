package app

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRunRecoversLegacySDKTransactionAndV3EntryProjections(t *testing.T) {
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
		switch descriptor.Dataset {
		case "transactions", "transaction-results", "operations", "ledger-entry-changes":
			if err := os.Remove(checkedStoragePath(t, root, descriptor.StorageKey)); err != nil {
				t.Fatal(err)
			}
		}
	}
	recovered, err := Run(context.Background(), config)
	if err != nil || !reflect.DeepEqual(recovered.Outputs, manifest.Outputs) {
		t.Fatalf("legacy three-family recovery changed descriptors: %v", err)
	}
	if got := readTypedManifest(t, manifestPath); !reflect.DeepEqual(got, manifest) {
		t.Fatal("legacy recovery rewrote the original manifest")
	}
	for _, descriptor := range manifest.Outputs {
		if descriptor.Dataset == "account-state-changes" {
			if err := os.Remove(checkedStoragePath(t, root, descriptor.StorageKey)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := Run(context.Background(), config); err == nil {
		t.Fatal("accepted an unqualified missing legacy state projection")
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
