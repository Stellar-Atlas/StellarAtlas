package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
)

func TestRunRecoversCompatibleLegacyManifestVersions(t *testing.T) {
	for _, version := range []string{manifestVersionV6, manifestVersionV7} {
		t.Run(version, func(t *testing.T) {
			root := t.TempDir()
			outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
			config := fixtureConfig(root, outputDirectory)
			receipt, err := Run(context.Background(), config)
			if err != nil {
				t.Fatalf("publish current shard: %v", err)
			}

			manifestPath := checkedStoragePath(t, root, receipt.ManifestStorageKey)
			manifest := readTypedManifest(t, manifestPath)
			for _, descriptor := range manifest.Outputs[8:] {
				if err := os.Remove(checkedStoragePath(t, root, descriptor.StorageKey)); err != nil {
					t.Fatalf("remove current-only output %s: %v", descriptor.Dataset, err)
				}
			}
			manifest.ManifestVersion = version
			manifest.Outputs = append([]output.Descriptor(nil), manifest.Outputs[:8]...)
			if version == manifestVersionV6 {
				manifest.Outputs[6].SchemaVersion = "stellar-atlas.full-history.contract-events.v2"
				manifest.Outputs[7].SchemaVersion = "stellar-atlas.full-history.ledger-entry-changes.v2"
			}
			manifest.Unsupported, err = unsupportedDatasetsForVersion(version)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(manifestPath); err != nil {
				t.Fatalf("remove current manifest: %v", err)
			}
			if err := writeManifest(outputDirectory, manifest); err != nil {
				t.Fatalf("write legacy manifest: %v", err)
			}
			legacyManifest := readTypedManifest(t, manifestPath)

			recovered, err := Run(context.Background(), config)
			if err != nil {
				t.Fatalf("recover %s shard: %v", version, err)
			}
			if len(recovered.Outputs) != 8 {
				t.Fatalf("recovered %d outputs, expected 8", len(recovered.Outputs))
			}
			if !reflect.DeepEqual(recovered.Outputs, legacyManifest.Outputs) {
				t.Fatal("recovery changed legacy output descriptors")
			}
			if got := readTypedManifest(t, manifestPath); !reflect.DeepEqual(got, legacyManifest) {
				t.Fatal("recovery rewrote the legacy manifest")
			}
		})
	}
}

func readTypedManifest(t *testing.T, manifestPath string) Manifest {
	t.Helper()
	encoded, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest Manifest
	if err := json.Unmarshal(encoded, &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	return manifest
}
