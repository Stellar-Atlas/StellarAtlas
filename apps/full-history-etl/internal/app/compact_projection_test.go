package app

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/output"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/transform"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/reader"
)

func TestCompactLedgerEntryChangesFromCanonicalReplay(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	legacyConfig := fixtureConfig(root, filepath.Join(root, "legacy"))
	legacy, err := Run(ctx, legacyConfig)
	if err != nil {
		t.Fatal(err)
	}
	compactConfig := fixtureConfig(root, filepath.Join(root, "compact"))
	compactConfig.CompactLedgerEntryChanges = true
	compact, err := Run(ctx, compactConfig)
	if err != nil {
		t.Fatal(err)
	}
	for version, receipt := range map[string]ProcessingReceipt{manifestVersionV8: legacy, manifestVersionV9: compact} {
		raw, err := os.ReadFile(checkedStoragePath(t, root, receipt.ManifestStorageKey))
		if err != nil {
			t.Fatal(err)
		}
		manifest, err := decodeManifest(raw)
		if err != nil || manifest.ManifestVersion != version {
			t.Fatalf("expected manifest %s: %v", version, err)
		}
	}
	before := projectionDescriptor(t, legacy.Outputs, "ledger-entry-changes")
	after := projectionDescriptor(t, compact.Outputs, "ledger-entry-changes")
	if before.RecordCount != 879 || after.RecordCount != before.RecordCount ||
		after.SchemaVersion != output.CompactLedgerEntryChangeSchemaVersion ||
		after.ByteCount >= before.ByteCount {
		t.Fatalf("unexpected compact output: before=%+v after=%+v", before, after)
	}
	beforePath := checkedStoragePath(t, root, before.StorageKey)
	afterPath := checkedStoragePath(t, root, after.StorageKey)
	oldColumns := parquetColumns(t, beforePath)
	newColumns := parquetColumns(t, afterPath)
	var wantColumns []string
	for _, name := range oldColumns {
		if name != "pre_entry_xdr" && name != "post_entry_xdr" {
			wantColumns = append(wantColumns, name)
		}
	}
	if len(oldColumns)-len(wantColumns) != 2 || !reflect.DeepEqual(newColumns, wantColumns) {
		t.Fatalf("unexpected compact columns: %v, want %v", newColumns, wantColumns)
	}
	oldRows := readProjectionRows[model.LedgerEntryChange](t, beforePath, int(before.RecordCount))
	newRows := readProjectionRows[model.CompactLedgerEntryChange](t, afterPath, int(after.RecordCount))
	for index, row := range newRows {
		oldRow := reflect.ValueOf(oldRows[index])
		newRow := reflect.ValueOf(row)
		for field := range newRow.NumField() {
			name := newRow.Type().Field(field).Name
			if !reflect.DeepEqual(oldRow.FieldByName(name).Interface(), newRow.Field(field).Interface()) {
				t.Fatalf("retained field %s changed at row %d", name, index)
			}
		}
	}
	if len(legacy.Outputs) != len(compact.Outputs) {
		t.Fatal("changed dataset count")
	}
	for _, descriptor := range legacy.Outputs {
		if descriptor.Dataset == before.Dataset {
			continue
		}
		newDescriptor := projectionDescriptor(t, compact.Outputs, descriptor.Dataset)
		descriptor.StorageKey = newDescriptor.StorageKey
		if descriptor != newDescriptor {
			t.Fatalf("non-target dataset changed: %s", descriptor.Dataset)
		}
	}

	// Reconstruct from the paired published LCM, not from the original SEP-54 input.
	canonical := projectionDescriptor(t, compact.Outputs, "ledger-close-meta")
	batch, err := lcmbatch.DecodeFile(checkedStoragePath(t, root, canonical.StorageKey),
		compactConfig.StartLedger, compactConfig.EndLedger, lcmbatch.Limits{
			MaxCompressedBytes: compactConfig.MaxOutputBytes, MaxUncompressedBytes: compactConfig.MaxUncompressedBytes,
			MaxDecodedMemoryBytes: compactConfig.MaxDecodedMemoryBytes, MaxLedgers: compactConfig.MaxLedgers,
		})
	if err != nil {
		t.Fatal(err)
	}
	if batch.CompressedSHA256 != canonical.SHA256 {
		t.Fatal("replay did not use the manifest's canonical LCM")
	}
	replayOutputs, err := output.OpenCollection(t.TempDir(), compactConfig.MaxOutputBytes, batch.Start, batch.End, false)
	if err != nil {
		t.Fatal(err)
	}
	defer replayOutputs.Abort()
	processor, err := transform.NewProcessor(replayOutputs, compactConfig.NetworkPassphrase, compactConfig.MaxRows)
	if err != nil {
		t.Fatal(err)
	}
	if err := processor.Process(ctx, batch, compactConfig.MaxDecodedMemoryBytes); err != nil {
		t.Fatal(err)
	}
	replayed, err := replayOutputs.Finish()
	if err != nil {
		t.Fatal(err)
	}
	reconstruction := projectionDescriptor(t, replayed, "ledger-entry-changes")
	if reconstruction.SHA256 != before.SHA256 || reconstruction.RecordCount != before.RecordCount {
		t.Fatal("canonical replay did not reproduce the exact legacy projection, including pre/post bodies")
	}
	t.Logf("one-ledger fixture (%d rows): v3 %d B, compact v4 %d B; reconstructed v3 SHA-256 %s", before.RecordCount, before.ByteCount, after.ByteCount, reconstruction.SHA256)

	recovered, err := Run(ctx, compactConfig)
	if err != nil || !reflect.DeepEqual(recovered, compact) {
		t.Fatalf("compact recovery did not preserve the exact receipt: %v", err)
	}
	for _, config := range []Config{legacyConfig, compactConfig} {
		config.CompactLedgerEntryChanges = !config.CompactLedgerEntryChanges
		if _, err := Run(ctx, config); err == nil || !strings.Contains(err.Error(), "different ledger-entry-changes projection mode") {
			t.Fatalf("recovery accepted another projection mode: %v", err)
		}
	}
	if digestPath(t, beforePath) != before.SHA256 || digestPath(t, afterPath) != after.SHA256 {
		t.Fatal("refused recovery changed an existing artifact")
	}
}

func projectionDescriptor(t *testing.T, descriptors []output.Descriptor, dataset string) output.Descriptor {
	t.Helper()
	for _, descriptor := range descriptors {
		if descriptor.Dataset == dataset {
			return descriptor
		}
	}
	t.Fatalf("missing %s descriptor", dataset)
	return output.Descriptor{}
}

func parquetColumns(t *testing.T, filePath string) []string {
	t.Helper()
	in, err := local.NewLocalFileReader(filePath)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	r, err := reader.NewParquetReader(in, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer r.ReadStop()
	var names []string
	for _, element := range r.Footer.Schema[1:] {
		names = append(names, strings.ToLower(element.GetName()))
	}
	return names
}

func readProjectionRows[T any](t *testing.T, filePath string, count int) []T {
	t.Helper()
	in, err := local.NewLocalFileReader(filePath)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	r, err := reader.NewParquetReader(in, new(T), 1)
	if err != nil {
		t.Fatal(err)
	}
	defer r.ReadStop()
	rows := make([]T, count)
	if err := r.Read(&rows); err != nil || len(rows) != count {
		t.Fatalf("read %d rows: %v", len(rows), err)
	}
	return rows
}
