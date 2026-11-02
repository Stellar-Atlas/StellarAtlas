package clickhouse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func TestAutoInitializationSkipsInstalledIndexesAndAddsOnlyMissing(t *testing.T) {
	for _, missing := range []string{"", "idx_operation_id"} {
		t.Run("missing="+missing, func(t *testing.T) {
			var installed []installedSkippingIndex
			var wantAlter string
			for _, dataset := range schema.Datasets() {
				statements, err := schema.SkippingIndexSQL("test", dataset)
				if err != nil {
					t.Fatal(err)
				}
				for _, statement := range statements {
					parts := skippingIndexStatement.FindStringSubmatch(statement)
					if parts == nil {
						t.Fatal("fixture does not recognize generated definition")
					}
					if parts[3] == missing {
						wantAlter = statement
						continue
					}
					installed = append(installed, installedSkippingIndex{
						Table: parts[2], Name: parts[3], Type: strings.Split(parts[5], "(")[0],
						TypeFull: parts[5], Expression: "`" + parts[4] + "`", Granularity: parts[6],
					})
				}
			}
			metadataReads := 0
			var ingestionAlters []string
			var alters []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				query := r.URL.Query().Get("query")
				switch {
				case strings.Contains(query, "system.data_skipping_indices"):
					metadataReads++
					_ = json.NewEncoder(w).Encode(map[string]any{"data": installed})
				case strings.Contains(query, "system.tables"):
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"engine": "ReplacingMergeTree", "comment": ""}}})
				case strings.Contains(query, "system.columns"):
					_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{
						{"name": "details", "type": "Dynamic", "default_kind": "", "default_expression": ""},
						{"name": "details_json", "type": "Dynamic", "default_kind": "", "default_expression": ""},
					}})
				case strings.HasPrefix(query, "ALTER TABLE `test`._ingestion_batches "):
					ingestionAlters = append(ingestionAlters, query)
				case strings.HasPrefix(query, "ALTER TABLE "):
					alters = append(alters, query)
				}
			}))
			defer server.Close()
			client, err := New(Config{Endpoint: server.URL, Database: "test", AutoStorageLayout: true})
			if err != nil {
				t.Fatal(err)
			}
			if err := client.Initialize(context.Background()); err != nil {
				t.Fatal(err)
			}
			const wantIngestionAlter = "ALTER TABLE `test`._ingestion_batches ADD COLUMN IF NOT EXISTS expected_dataset_rows Map(String, UInt64) DEFAULT map(), ADD COLUMN IF NOT EXISTS projection_contract LowCardinality(String) DEFAULT ''"
			if len(ingestionAlters) != 1 || ingestionAlters[0] != wantIngestionAlter {
				t.Fatalf("expected one idempotent metadata-only projection declaration: %v", ingestionAlters)
			}
			if metadataReads != 1 || missing == "" && len(alters) != 0 || missing != "" && (len(alters) != 1 || alters[0] != wantAlter) {
				t.Fatalf("metadata reads=%d unexpected ALTERs=%v", metadataReads, alters)
			}
		})
	}
}

func TestInstalledIndexDefinitionMismatchFailsClosed(t *testing.T) {
	statement := "ALTER TABLE `test`.`history_operations` ADD INDEX IF NOT EXISTS `idx_operation_id` `id` TYPE minmax GRANULARITY 1"
	baseline := installedSkippingIndex{Table: "history_operations", Name: "idx_operation_id", Type: "minmax", TypeFull: "minmax", Expression: "id", Granularity: "1"}
	for _, changed := range []string{"none", "expression", "type", "granularity"} {
		index := baseline
		switch changed {
		case "expression":
			index.Expression = "transaction_id"
		case "type":
			index.Type, index.TypeFull = "bloom_filter", "bloom_filter(0.01)"
		case "granularity":
			index.Granularity = "2"
		}
		exists, err := (installedSkippingIndexes{"history_operations.idx_operation_id": index}).compatible(statement)
		if changed == "none" && (!exists || err != nil) || changed != "none" && err == nil {
			t.Fatalf("case %s exists=%v error=%v", changed, exists, err)
		}
	}
}
