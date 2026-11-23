package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

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
