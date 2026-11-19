package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
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

func TestRetiredDerivedOutputRecoveryPreservesOriginalManifest(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	config := fixtureConfig(root, directory)
	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := checkedStoragePath(t, root, receipt.ManifestStorageKey)
	rawManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest := readTypedManifest(t, manifestPath)
	var derived, canonical output.Descriptor
	for _, descriptor := range manifest.Outputs {
		if descriptor.Dataset == "transactions" {
			derived = descriptor
		}
		if descriptor.Dataset == "ledger-close-meta" {
			canonical = descriptor
		}
	}
	authority := derivedRetirementRecovery{
		Version: 1, BatchID: "00000000-0000-4000-8000-000000000001",
		NetworkID: manifest.Network.NetworkIDSHA256, Start: manifest.Range.StartLedger,
		End: manifest.Range.EndLedger, ManifestSHA256: receipt.ManifestSHA256,
		CanonicalSHA256: canonical.SHA256,
		Outputs: []derivedRetirementOutput{{
			Dataset: derived.Dataset, SHA256: derived.SHA256, Bytes: strconv.FormatInt(derived.ByteCount, 10),
			Rows: strconv.FormatUint(derived.RecordCount, 10), StorageKey: derived.StorageKey,
			EvidenceSHA256: strings.Repeat("a", 64), TransformRevision: strings.Repeat("b", 40),
		}},
	}
	if _, err := validateRetirementRecovery(authority, rawManifest, manifest); err != nil {
		t.Fatal(err)
	}
	invalid := authority
	invalid.CanonicalSHA256 = strings.Repeat("c", 64)
	if _, err := validateRetirementRecovery(invalid, rawManifest, manifest); err == nil {
		t.Fatal("wrong canonical authority accepted")
	}
	if err := os.Remove(checkedStoragePath(t, root, derived.StorageKey)); err != nil {
		t.Fatal(err)
	}
	if _, err := Run(context.Background(), config); err == nil {
		t.Fatal("missing output accepted without authority")
	}
	authorityPath := filepath.Join(t.TempDir(), "authority.json")
	writeAuthority := func() {
		raw, err := json.Marshal(authority)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(authorityPath, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeAuthority()
	config.RetirementRecoveryPath = authorityPath
	if _, err := Run(context.Background(), config); err == nil {
		t.Fatal("unconfirmed removal accepted")
	}
	authority.Outputs[0].Removed = true
	writeAuthority()
	recovered, err := Run(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recovered.Outputs, receipt.Outputs) || recovered.ManifestSHA256 != receipt.ManifestSHA256 {
		t.Fatal("recovery rewrote immutable evidence")
	}
	after, err := os.ReadFile(manifestPath)
	if err != nil || string(after) != string(rawManifest) {
		t.Fatal("manifest bytes changed")
	}
	authority.Outputs[0].Dataset = "ledger-close-meta"
	if _, err := validateRetirementRecovery(authority, rawManifest, manifest); err == nil {
		t.Fatal("canonical retirement accepted")
	}
}
