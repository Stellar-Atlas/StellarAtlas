package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestOnDemandProjectionMatchesOriginalWriter(t *testing.T) {
	for _, compact := range []bool{false, true} {
		t.Run(fmt.Sprintf("compact-%t", compact), func(t *testing.T) {
			root := t.TempDir()
			cfg := fixtureConfig(root, filepath.Join(root, "full"))
			cfg.CompactLedgerEntryChanges = compact
			full, err := Run(context.Background(), cfg)
			if err != nil {
				t.Fatal(err)
			}
			canonical := full.Outputs[0]
			cache := t.TempDir()
			if err := os.Chmod(cache, 0700); err != nil {
				t.Fatal(err)
			}
			c := MaterializationConfig{
				CanonicalPath:          checkedStoragePath(t, root, canonical.StorageKey),
				ManifestPath:           checkedStoragePath(t, root, full.ManifestStorageKey),
				ExpectedManifestSHA256: full.ManifestSHA256, ExpectedSourceSHA256: canonical.SHA256,
				CacheRoot: cache, CacheMaxBytes: 32 << 20, NetworkPassphrase: cfg.NetworkPassphrase, Timeout: time.Minute,
				Limits: ManifestLimits{MaxCompressedBytes: cfg.MaxCompressedBytes, MaxUncompressedBytes: 0,
					MaxDecodedMemoryBytes: cfg.MaxDecodedMemoryBytes, MaxLedgers: 1},
			}
			for _, d := range full.Outputs[1:] {
				if compact && d.Dataset != "ledger-entry-changes" {
					continue
				} // Other families use identical writers.
				t.Run(d.Dataset, func(t *testing.T) {
					c.Dataset = d.Dataset
					c.Limits.MaxOutputBytes, c.Limits.MaxRows = d.ByteCount, max(1, d.RecordCount)
					called := false
					err := WithMaterializedOutput(context.Background(), c, func(o MaterializedOutput) error {
						called = true
						entries, err := os.ReadDir(filepath.Dir(o.Path))
						if err != nil {
							return err
						}
						if len(entries) != 2 || o.CacheHit || o.SHA256 != d.SHA256 || digestPath(t, o.Path) != d.SHA256 {
							t.Fatalf("not exactly the original requested projection and receipt: %s", d.Dataset)
						}
						return nil
					})
					if err != nil || !called {
						t.Fatalf("materialize original: %v", err)
					}
				})
			}
			if !compact {
				t.Run("temporary response exceeds retention but leaves no cache entry", func(t *testing.T) {
					dir, err := os.MkdirTemp("/dev/shm", "atlas-projection-test-")
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if err := os.RemoveAll(dir); err != nil {
							t.Error(err)
						}
					})
					temp := c
					temp.CacheRoot = dir
					temp.CacheMaxBytes = 64 << 10
					for _, d := range full.Outputs {
						if d.Dataset != "ledger-entry-changes" {
							continue
						}
						temp.Dataset = d.Dataset
						temp.Limits.MaxRows = max(1, d.RecordCount)
						temp.Limits.MaxOutputBytes = d.ByteCount
						if err := WithMaterializedOutput(context.Background(), temp, func(MaterializedOutput) error { return nil }); err == nil {
							t.Fatal("overflow ran without an approved RAM budget")
						}
						temp.TransientMaxBytes = 4 << 20
						var held string
						err := WithMaterializedOutput(context.Background(), temp, func(result MaterializedOutput) error {
							if result.CacheHit || !result.Transient || digestPath(t, result.Path) != d.SHA256 {
								t.Fatal("temporary response is not verified original bytes")
							}
							held = result.Path
							return nil
						})
						if err != nil || held == "" {
							t.Fatalf("transient stream: %v", err)
						}
						if _, err := os.Lstat(held); !os.IsNotExist(err) {
							t.Fatal("completed temporary response remained on disk")
						}
						names, err := os.ReadDir(dir)
						if err != nil || len(names) != 1 || names[0].Name() != ".publish.lock" {
							t.Fatal("large response occupied the retained cache")
						}
						return
					}
					t.Fatal("original ledger-entry fixture missing")
				})
			}
			// A new catalogue digest may authorize a different original manifest,
			// but cannot introduce a writer the binary does not implement.
			raw, err := os.ReadFile(c.ManifestPath)
			if err != nil {
				t.Fatal(err)
			}
			manifest, err := decodeManifest(raw)
			if err != nil {
				t.Fatal(err)
			}
			m := manifest
			m.SourceObjects = append([]SourceEvidence(nil), manifest.SourceObjects...)
			const recorded = int64(2<<30) + 4096
			m.SourceObjects[0].XDRByteCount = recorded
			m.Limits.MaxUncompressedBytes = recorded
			if n, err := registeredWireLength(m, 0); err != nil || n != recorded {
				t.Fatalf("did not use exact registered length: %d %v", n, err)
			}
			if _, err := registeredWireLength(m, 2<<30); err == nil {
				t.Fatal("ignored explicit caller cap")
			}
			manifest.Format.ParquetWriter += "-unknown"
			raw, err = json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			c.ManifestPath = filepath.Join(root, "unsupported.json")
			if err := os.WriteFile(c.ManifestPath, raw, 0600); err != nil {
				t.Fatal(err)
			}
			c.ExpectedManifestSHA256 = digestPath(t, c.ManifestPath)
			if _, _, err := materializationManifest(c); err == nil {
				t.Fatal("accepted a different writer")
			}
		})
	}
	for _, dataset := range []string{"contract-events", "ledger-entry-changes", "account-state-changes", "trustline-state-changes"} {
		if _, err := materializationSpec(manifestVersionV6, dataset); err == nil {
			t.Fatalf("accepted unavailable v6 writer for %s", dataset)
		}
	}
}

func TestTransactionReconstructionMatchesFullOutputsWithoutClaimingCompleteness(t *testing.T) {
	root := t.TempDir()
	full, err := Run(context.Background(), fixtureConfig(root, filepath.Join(root, "full")))
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Outputs) != 10 {
		t.Fatalf("normal ingestion changed its output count: %d", len(full.Outputs))
	}
	fullByDataset := make(map[string]int)
	for index, descriptor := range full.Outputs {
		fullByDataset[descriptor.Dataset] = index
	}
	canonical := full.Outputs[fullByDataset["ledger-close-meta"]]
	input := checkedStoragePath(t, root, canonical.StorageKey)
	output := filepath.Join(root, "reconstructed")
	config := fixtureConfig(root, output)
	config.Sources = []Source{{Path: input, ObjectKey: "reconstruction/canonical.xdr.zstd"}}
	// The three selected families contain exactly 560 rows. Normal event/state
	// traversal would exceed this limit, so it cannot hide behind empty sinks.
	config.MaxRows = 560
	reconstruction := TransactionReconstructionConfig{Config: config, ExpectedSourceSHA256: canonical.SHA256}
	receipt, err := RunTransactionReconstruction(context.Background(), reconstruction)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.CompleteDatasetSet || receipt.Purpose != "offline-transaction-reconstruction" ||
		receipt.ReceiptVersion != "stellar-atlas.full-history.transaction-reconstruction.v1" || len(receipt.Outputs) != 3 {
		t.Fatalf("partial output was not clearly identified: %+v", receipt)
	}
	for _, descriptor := range receipt.Outputs {
		index, ok := fullByDataset[descriptor.Dataset]
		if !ok || (descriptor.Dataset != "transactions" && descriptor.Dataset != "operations" && descriptor.Dataset != "transaction-results") {
			t.Fatalf("unexpected reconstructed family: %s", descriptor.Dataset)
		}
		original := full.Outputs[index]
		if descriptor.RecordCount != original.RecordCount || descriptor.ByteCount != original.ByteCount ||
			descriptor.SHA256 != original.SHA256 || descriptor.SchemaVersion != original.SchemaVersion ||
			digestPath(t, checkedStoragePath(t, root, descriptor.StorageKey)) != original.SHA256 {
			t.Fatalf("reconstruction differs from the full writer: %s", descriptor.Dataset)
		}
	}
	entries, err := os.ReadDir(output)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	if !reflect.DeepEqual(names, []string{"operations.parquet", "reconstruction.json", "transaction-results.parquet", "transactions.parquet"}) {
		t.Fatalf("unrelated output or normal manifest was produced: %v", names)
	}
	if digestPath(t, input) != canonical.SHA256 {
		t.Fatal("canonical source changed")
	}
	encoded, err := os.ReadFile(filepath.Join(output, reconstructionReceiptFilename))
	if err != nil {
		t.Fatal(err)
	}
	var saved TransactionReconstructionReceipt
	if err := json.Unmarshal(encoded, &saved); err != nil || !reflect.DeepEqual(saved, receipt) {
		t.Fatalf("reconstruction receipt differs: %v", err)
	}
	if _, err := RunTransactionReconstruction(context.Background(), reconstruction); err == nil {
		t.Fatal("existing reconstruction leaf was accepted or replaced")
	}
	if digestPath(t, filepath.Join(output, "transactions.parquet")) != full.Outputs[fullByDataset["transactions"]].SHA256 {
		t.Fatal("existing reconstruction changed on a refused repeat")
	}
	bad := reconstruction
	bad.Config.OutputPath = filepath.Join(root, "wrong-digest")
	bad.ExpectedSourceSHA256 = strings.Repeat("0", 64)
	if _, err := RunTransactionReconstruction(context.Background(), bad); err == nil {
		t.Fatal("unexpected source digest was accepted")
	}
	if _, err := os.Lstat(bad.Config.OutputPath); !os.IsNotExist(err) {
		t.Fatal("a digest-mismatched result was published")
	}

	cache := t.TempDir()
	if err := os.Chmod(cache, 0o700); err != nil {
		t.Fatal(err)
	}
	materialization := MaterializationConfig{
		CanonicalPath: input, ManifestPath: checkedStoragePath(t, root, full.ManifestStorageKey),
		ExpectedManifestSHA256: full.ManifestSHA256, ExpectedSourceSHA256: canonical.SHA256,
		Dataset: "transactions", CacheRoot: cache, CacheMaxBytes: 64 << 20,
		NetworkPassphrase: config.NetworkPassphrase, Timeout: 30 * time.Second,
		Limits: ManifestLimits{MaxCompressedBytes: config.MaxCompressedBytes,
			MaxUncompressedBytes: config.MaxUncompressedBytes, MaxDecodedMemoryBytes: config.MaxDecodedMemoryBytes,
			MaxOutputBytes: config.MaxOutputBytes, MaxLedgers: 64, MaxRows: config.MaxRows},
	}
	for _, hit := range []bool{false, true} {
		calls := 0
		err := WithMaterializedOutput(context.Background(), materialization, func(value MaterializedOutput) error {
			calls++
			if value.CacheHit != hit || value.Version != 1 || value.Dataset != "transactions" ||
				value.SHA256 != full.Outputs[fullByDataset["transactions"]].SHA256 ||
				digestPath(t, value.Path) != value.SHA256 {
				t.Fatalf("incorrect materialization: %+v", value)
			}
			if hit {
				// Another API process cannot rebuild/evict until this callback has
				// opened the result. Existing flock works across separate handles.
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
				defer cancel()
				if err := WithMaterializedOutput(ctx, materialization, func(MaterializedOutput) error {
					t.Fatal("second materializer entered while lock held")
					return nil
				}); err == nil {
					t.Fatal("contending materializer did not honor cancellation")
				}
			}
			return nil
		})
		if err != nil || calls != 1 {
			t.Fatalf("materialization hit=%v calls=%d error=%v", hit, calls, err)
		}
	}
	materialization.ExpectedManifestSHA256 = strings.Repeat("0", 64)
	if err := WithMaterializedOutput(context.Background(), materialization, func(MaterializedOutput) error {
		t.Fatal("mismatched manifest exposed a cached output")
		return nil
	}); err == nil {
		t.Fatal("expected manifest digest rejection")
	}
}
