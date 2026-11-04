package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func TestSingleCopyOperationPreservesOfficialRowAndIdentity(t *testing.T) {
	details := map[string]interface{}{"precise": uint64(18446744073709551615), "text": "0123"}
	operation := transform.OperationOutput{OperationDetails: details, OperationDetailsJSON: details}
	identity := BatchIdentity{ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", SourceSHA256: strings.Repeat("a", 64), StartLedger: 12, EndLedger: 12}
	ingested := time.Unix(123, 0).UTC()
	baseline, err := encodeRow(operation, identity, 12, 0, ingested)
	if err != nil {
		t.Fatal(err)
	}
	want := decodeJSON(t, baseline).(map[string]any)
	delete(want, "details")
	for _, row := range []any{operation, &operation} {
		writer, err := NewBatchWriter(&Client{singleCopyOperations: true}, identity, WriterLimits{MaximumRows: 100, MaximumBytes: 1 << 20})
		if err != nil {
			t.Fatal(err)
		}
		writer.ingestedAt = ingested
		if err := writer.Emit(context.Background(), "history_operations", 12, row); err != nil {
			t.Fatal(err)
		}
		got := decodeJSON(t, writer.tables["history_operations"].body.Bytes()).(map[string]any)
		if !reflect.DeepEqual(got, want) || writer.TotalRows() != 1 || writer.ExpectedRows()["history_operations"] != 1 {
			t.Fatalf("single-copy row, metadata or counts changed: %#v", got)
		}
		if got["details_json"].(map[string]any)["precise"] != json.Number("18446744073709551615") {
			t.Fatal("integer precision changed")
		}
	}
	for _, row := range []any{json.RawMessage(`{"details_json":{}}`), (*transform.OperationOutput)(nil)} {
		if _, err := singleCopyOperationRow(row); err == nil {
			t.Fatal("unknown or nil official row must fail closed")
		}
	}
	if !bytes.Contains(baseline, []byte(`"details":`)) {
		t.Fatal("default encoding must retain the original layout")
	}
}

func TestSingleCopyInsertUsesPhysicalNativeColumnsAndVersionedToken(t *testing.T) {
	var captured capturedInsert
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured = capturedInsert{r.URL.Query().Get("query"), r.URL.Query().Get("param_token"), body}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "test", SingleCopyOperations: true})
	if err != nil {
		t.Fatal(err)
	}
	dataset, _ := schema.Lookup("history_operations")
	all, err := schema.Columns(dataset)
	if err != nil {
		t.Fatal(err)
	}
	columns := operationInsertColumns(all)
	if len(columns) != len(all)-1 {
		t.Fatal("must exclude exactly the duplicate column")
	}
	// Build valid values for every physical wire column without depending on a
	// particular upstream optional-field zero value or a running ClickHouse.
	values := make(map[string]any, len(columns))
	for _, column := range columns {
		switch {
		case column.Name == "_batch_id":
			values[column.Name] = "3dca0dce-5e01-4620-a95b-e95ce4a58323"
		case column.Name == "_source_sha256":
			values[column.Name] = strings.Repeat("a", 64)
		case column.Type == "Dynamic":
			values[column.Name] = map[string]any{"integer": uint64(9007199254740993)}
		case strings.HasPrefix(column.Type, "DateTime"):
			values[column.Name] = "2026-10-29T00:00:00Z"
		case strings.HasPrefix(column.Type, "Nullable("):
			values[column.Name] = nil
		case strings.HasPrefix(column.Type, "Array("):
			values[column.Name] = []string{}
		case column.Type == "String" || strings.HasPrefix(column.Type, "FixedString("):
			values[column.Name] = ""
		case column.Type == "Bool":
			values[column.Name] = false
		default:
			values[column.Name] = 0
		}
	}
	rows, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := encodeNativeRows(columns, rows)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Insert(context.Background(), "history_operations", "batch:history_operations:0", rows); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(captured.query, "FORMAT Native") || strings.Contains(captured.query, "`details`") || !strings.Contains(captured.query, "`details_json`") {
		t.Fatalf("incorrect explicit Native projection: %s", captured.query)
	}
	if captured.token != "batch:history_operations:0:single-copy-v1:native-v1" || !bytes.Equal(captured.body, expected) {
		t.Fatal("Native values or layout-versioned token changed")
	}
}

func TestSingleCopyReadinessRequiresExactAliasAndFreshSchema(t *testing.T) {
	for _, check := range []struct {
		kind, expression, physicalType string
		valid                          bool
	}{
		{"ALIAS", "details_json", "Dynamic", true},
		{"ALIAS", "`details_json`", "Dynamic", true},
		{"", "", "Dynamic", false},
		{"ALIAS", "other", "Dynamic", false},
		{"MATERIALIZED", "details_json", "Dynamic", false},
		{"ALIAS", "details_json", "String", false},
	} {
		t.Run(check.kind+"/"+check.expression+"/"+check.physicalType, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				query := r.URL.Query().Get("query")
				if !strings.Contains(query, "system.columns") {
					if !strings.HasPrefix(query, "DESCRIBE TABLE ") {
						t.Errorf("readiness attempted a non-metadata query: %s", query)
					}
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{
					{"name": "details", "type": "Dynamic", "default_kind": check.kind, "default_expression": check.expression},
					{"name": "details_json", "type": check.physicalType, "default_kind": "", "default_expression": ""},
				}})
			}))
			defer server.Close()
			client, err := New(Config{Endpoint: server.URL, Database: "test", SingleCopyOperations: true})
			if err != nil {
				t.Fatal(err)
			}
			err = client.CheckReady(context.Background())
			if (err == nil) != check.valid || err != nil && !strings.Contains(err.Error(), "migration required") {
				t.Fatalf("valid=%v error=%v", check.valid, err)
			}
			dataset, _ := schema.Lookup("history_operations")
			statement, err := client.tableSQL(dataset)
			if err != nil || !strings.Contains(statement, "`details` Dynamic ALIAS `details_json`") {
				t.Fatalf("fresh schema not single-copy: %v %s", err, statement)
			}
			client.singleCopyOperations = false
			legacy, err := client.tableSQL(dataset)
			if err != nil || strings.Contains(legacy, " ALIAS ") {
				t.Fatal("default schema changed")
			}
		})
	}
}
