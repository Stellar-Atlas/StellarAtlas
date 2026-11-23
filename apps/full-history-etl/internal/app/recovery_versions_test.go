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
			// The current writer can replay legacy transactions, but not v6's
			// obsolete event/change row models. Do not call those files caches.
			if err := os.Remove(checkedStoragePath(t, root, manifest.Outputs[1].StorageKey)); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), config); err != nil {
				t.Fatalf("recover cold legacy transaction: %v", err)
			}
			if err := os.Remove(checkedStoragePath(t, root, manifest.Outputs[6].StorageKey)); err != nil {
				t.Fatal(err)
			}
			_, err = Run(context.Background(), config)
			if (err != nil) != (version == manifestVersionV6) {
				t.Fatalf("cold event compatibility for %s: %v", version, err)
			}
		})
	}
}

func TestRunRecoversColdProjectionsOnlyWithCompleteManifestAndCanonical(t *testing.T) {
	for _, compact := range []bool{false, true} {
		t.Run(strconv.FormatBool(compact), func(t *testing.T) {
			root := t.TempDir()
			directory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
			config := fixtureConfig(root, directory)
			config.CompactLedgerEntryChanges = compact
			original, err := Run(context.Background(), config)
			if err != nil {
				t.Fatal(err)
			}
			manifestPath := checkedStoragePath(t, root, original.ManifestStorageKey)
			rawManifest, err := os.ReadFile(manifestPath)
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range original.Outputs[1:] {
				if err := os.Remove(checkedStoragePath(t, root, d.StorageKey)); err != nil {
					t.Fatal(err)
				}
			}
			recovered, err := Run(context.Background(), config)
			if err != nil || !reflect.DeepEqual(recovered, original) {
				t.Fatalf("cold recovery changed original receipt: %v", err)
			}
			assertPublishedFileSet(t, directory, 2)
			if raw, err := os.ReadFile(manifestPath); err != nil || string(raw) != string(rawManifest) {
				t.Fatal("cold recovery changed original manifest")
			}
			// A newly present bad export is corruption, not a reason to bypass validation.
			derivedPath := checkedStoragePath(t, root, original.Outputs[1].StorageKey)
			if err := os.WriteFile(derivedPath, []byte("PAR1bad!PAR1"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), config); err == nil {
				t.Fatal("corrupt present export was treated as cold")
			}
			if err := os.Remove(derivedPath); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(manifestPath); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), config); err == nil {
				t.Fatal("incomplete batch without manifest was accepted")
			}
			if err := os.WriteFile(manifestPath, rawManifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(checkedStoragePath(t, root, original.Outputs[0].StorageKey)); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), config); err == nil {
				t.Fatal("missing canonical source was accepted")
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
	if recovered, err := Run(context.Background(), config); err != nil || !reflect.DeepEqual(recovered.Outputs, receipt.Outputs) {
		t.Fatalf("committed reproducible output did not recover without retirement authority: %v", err)
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

func TestRetirementRecoveryVersionedNamespacePolicy(t *testing.T) {
	tests := []struct {
		name              string
		version           int
		removed           bool
		namespace         bool
		fileState         string
		mutation          string
		wantError         bool
		checkPhysicalJSON bool
	}{
		{name: "v1 rejects explicit false namespace", version: 1, mutation: "namespace-false", wantError: true},
		{name: "v1 rejects explicit null intent", version: 1, mutation: "intent-null", wantError: true},
		{name: "v2 namespace absent", version: 2, namespace: true, fileState: "absent"},
		{name: "v2 namespace valid present", version: 2, namespace: true, checkPhysicalJSON: true},
		{name: "v2 namespace corrupt present", version: 2, namespace: true, fileState: "corrupt", wantError: true},
		{name: "v2 namespace symlink", version: 2, namespace: true, fileState: "symlink", wantError: true},
		{name: "v2 legacy physically removed absent", version: 2, removed: true, fileState: "absent"},
		{name: "v2 legacy physically removed restored", version: 2, removed: true, wantError: true},
		{name: "v2 pending absent", version: 2, fileState: "absent", wantError: true},
		{name: "v2 canonical required", version: 2, namespace: true, fileState: "canonical-absent", wantError: true},
		{name: "unknown version", version: 3, wantError: true},
		{name: "unknown authority key", version: 2, mutation: "unknown-top", wantError: true},
		{name: "missing namespace state", version: 2, mutation: "missing-state", wantError: true},
		{name: "missing null intent", version: 2, mutation: "missing-intent", wantError: true},
		{name: "null namespace state", version: 2, mutation: "namespace-null", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, original, authority, derivedPath, canonicalPath := retirementNamespaceFixture(t)
			authority.Version, authority.Outputs[0].Removed = test.version, test.removed
			if test.version == 2 {
				authority.Outputs[0].NamespaceRemoved = &test.namespace
				if test.namespace {
					intent := strings.Repeat("d", 64)
					authority.Outputs[0].NamespaceIntentSHA256 = &intent
				}
			}
			encoded := retirementNamespaceJSON(t, authority, test.mutation)
			if test.checkPhysicalJSON {
				checkRetirementPhysicalStateJSON(t, encoded)
			}
			if err := os.WriteFile(config.RetirementRecoveryPath, encoded, 0600); err != nil {
				t.Fatal(err)
			}
			switch test.fileState {
			case "absent":
				if err := os.Remove(derivedPath); err != nil {
					t.Fatal(err)
				}
			case "corrupt":
				raw, err := os.ReadFile(derivedPath)
				if err != nil {
					t.Fatal(err)
				}
				raw[len(raw)/2] ^= 1
				if err := os.WriteFile(derivedPath, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Remove(derivedPath); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(canonicalPath, derivedPath); err != nil {
					t.Fatal(err)
				}
			case "canonical-absent":
				if err := os.Remove(canonicalPath); err != nil {
					t.Fatal(err)
				}
			}
			recovered, err := Run(context.Background(), config)
			if (err != nil) != test.wantError {
				t.Fatalf("recovery error = %v, wantError = %v", err, test.wantError)
			}
			if err == nil && (recovered.ManifestSHA256 != original.ManifestSHA256 || !reflect.DeepEqual(recovered.Outputs, original.Outputs)) {
				t.Fatal("namespace recovery changed immutable evidence")
			}
		})
	}
}

// Reuse one already-produced fixture: these checks parse only small authority JSON.
func checkRetirementPhysicalStateJSON(t *testing.T, valid []byte) {
	t.Helper()
	for _, mutation := range []string{"missing", "null", "case-only", "case-override", "uppercase-override"} {
		t.Run("physical state "+mutation, func(t *testing.T) {
			var fields map[string]any
			if err := json.Unmarshal(valid, &fields); err != nil {
				t.Fatal(err)
			}
			item := fields["outputs"].([]any)[0].(map[string]any)
			switch mutation {
			case "missing":
				delete(item, "removed")
			case "null":
				item["removed"] = nil
			case "case-only":
				delete(item, "removed")
				item["Removed"] = false
			case "case-override":
				item["Removed"] = true
			case "uppercase-override":
				item["REMOVED"] = nil
			}
			raw, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateRetirementNamespaceJSON(raw, 2); err == nil {
				t.Fatal("version two accepted unknown or aliased physical state")
			}
			if err := validateRetirementNamespaceJSON(raw, 1); err == nil {
				t.Fatal("version one accepted namespace keys")
			}
			delete(item, "namespaceRemoved")
			delete(item, "namespaceIntentSha256")
			raw, err = json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateRetirementNamespaceJSON(raw, 1); err != nil {
				t.Fatalf("version one legacy physical-state interpretation changed: %v", err)
			}
		})
	}
}

func retirementNamespaceFixture(t *testing.T) (Config, ProcessingReceipt, derivedRetirementRecovery, string, string) {
	t.Helper()
	root := t.TempDir()
	config := fixtureConfig(root, filepath.Join(root, "network=pubnet", "range=53312000-53312000"))
	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	manifest := readTypedManifest(t, checkedStoragePath(t, root, receipt.ManifestStorageKey))
	var derived, canonical output.Descriptor
	for _, descriptor := range manifest.Outputs {
		if descriptor.Dataset == "transactions" {
			derived = descriptor
		}
		if descriptor.Dataset == "ledger-close-meta" {
			canonical = descriptor
		}
	}
	config.RetirementRecoveryPath = filepath.Join(t.TempDir(), "authority.json")
	authority := derivedRetirementRecovery{
		Version: 1, BatchID: "00000000-0000-4000-8000-000000000001",
		NetworkID: manifest.Network.NetworkIDSHA256, Start: manifest.Range.StartLedger, End: manifest.Range.EndLedger,
		ManifestSHA256: receipt.ManifestSHA256, CanonicalSHA256: canonical.SHA256,
		Outputs: []derivedRetirementOutput{{Dataset: derived.Dataset, SHA256: derived.SHA256,
			Bytes: strconv.FormatInt(derived.ByteCount, 10), Rows: strconv.FormatUint(derived.RecordCount, 10),
			StorageKey: derived.StorageKey, EvidenceSHA256: strings.Repeat("a", 64), TransformRevision: strings.Repeat("b", 40)}},
	}
	return config, receipt, authority, checkedStoragePath(t, root, derived.StorageKey), checkedStoragePath(t, root, canonical.StorageKey)
}

func retirementNamespaceJSON(t *testing.T, authority derivedRetirementRecovery, mutation string) []byte {
	t.Helper()
	raw, err := json.Marshal(authority)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	item := fields["outputs"].([]any)[0].(map[string]any)
	if authority.Version == 2 && authority.Outputs[0].NamespaceIntentSHA256 == nil {
		item["namespaceIntentSha256"] = nil
	}
	switch mutation {
	case "namespace-false":
		item["namespaceRemoved"] = false
	case "namespace-null":
		item["namespaceRemoved"] = nil
	case "intent-null":
		item["namespaceIntentSha256"] = nil
	case "unknown-top":
		fields["unknownAuthority"] = true
	case "missing-state":
		delete(item, "namespaceRemoved")
	case "missing-intent":
		delete(item, "namespaceIntentSha256")
	}
	raw, err = json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
