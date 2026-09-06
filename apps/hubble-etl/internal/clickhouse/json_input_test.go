package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/chcol"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Includes the actual mixed SCVal shape plus scalar cases which permissive
// JSON inference silently coerces. This is a regression, not a live transaction.
const mixedContractEvent = `{"data_decoded":{"map":[{"key":{"symbol":"name"},"val":"hello"},{"key":{"symbol":"nested"},"val":{"vec":[{"i128":"123456789012345678901234567890"},null,true,{"map":[]}]}},{"key":{"symbol":"empty"},"val":[]}],"u32":4294967295,"i32":-1,"u64":18446744073709551615,"decimal":1.25,"numeric_string":"0123","false_string":"false","true":true,"false":false,"null":null,"empty_object":{},"empty_array":[],"heterogeneous":[true,1,"1",null,{},[]]},"contract_event_xdr":"AAAA"}`

type capturedInsert struct {
	query, token string
	body         []byte
}

func TestInsertPreservesNativeTypesAndReplayIdentity(t *testing.T) {
	calls := make(chan capturedInsert, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls <- capturedInsert{r.URL.Query().Get("query"), r.URL.Query().Get("param_token"), body}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	client, err := New(Config{Endpoint: server.URL, Database: "hubble_test"})
	if err != nil {
		t.Fatal(err)
	}
	identity := BatchIdentity{ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", SourceSHA256: strings.Repeat("a", 64), StartLedger: 63490179, EndLedger: 63491202}
	for attempt := 1; attempt <= 2; attempt++ {
		writer, err := NewBatchWriter(client, identity, WriterLimits{MaximumRows: 100, MaximumBytes: 4096})
		if err != nil {
			t.Fatal(err)
		}
		writer.ingestedAt = time.Unix(int64(attempt), 0).UTC()
		if err := writer.Emit(context.Background(), "history_contract_events", 63490232, json.RawMessage(mixedContractEvent)); err != nil {
			t.Fatal(err)
		}
		if err := writer.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	first, second := <-calls, <-calls
	if first.token != second.token || first.token != identity.ID+":history_contract_events:0:native-v1" {
		t.Fatal("unstable token")
	}
	for _, call := range []capturedInsert{first, second} {
		if !strings.Contains(call.query, "FORMAT Native") || !strings.Contains(call.query, "async_insert=0") || !strings.Contains(call.query, "insert_deduplication_token={token:String}") {
			t.Fatal(call.query)
		}
		if strings.Contains(call.query, "input_format_allow_errors") {
			t.Fatal("must not skip malformed data")
		}
	}
	a := readNativeOffline(t, first.body)
	b := readNativeOffline(t, second.body)
	expected := decodeJSON(t, []byte(mixedContractEvent)).(map[string]any)
	if !reflect.DeepEqual(a["data_decoded"], expected["data_decoded"]) || a["contract_event_xdr"] != expected["contract_event_xdr"] {
		t.Fatalf("types, values, or original XDR changed: %#v", a)
	}
	if a["_ingested_at"] == b["_ingested_at"] {
		t.Fatal("retry must test different timestamps")
	}
	delete(a, "_ingested_at")
	delete(b, "_ingested_at")
	if !reflect.DeepEqual(a, b) || a["_row_number"] != json.Number("0") || a["_batch_id"] != identity.ID || a["_source_sha256"] != identity.SourceSHA256 {
		t.Fatal("immutable replay identity changed")
	}
}

func TestNativeInputExplicitScalarTypes(t *testing.T) {
	for _, tc := range []struct {
		input, kind string
		want        any
	}{
		{"255", "UInt8", uint8(255)}, {"65535", "UInt16", uint16(65535)},
		{"4294967295", "UInt32", uint32(4294967295)}, {"18446744073709551615", "UInt64", uint64(18446744073709551615)},
		{"-128", "Int8", int8(-128)}, {"-32768", "Int16", int16(-32768)},
		{"-2147483648", "Int32", int32(-2147483648)}, {"-9223372036854775808", "Int64", int64(-9223372036854775808)},
		{"1.25", "Float32", float32(1.25)}, {"1.25", "Float64", float64(1.25)},
		{"null", "Nullable(Int64)", nil}, {"true", "Bool", true},
		{`"0123"`, "String", "0123"},
	} {
		got, err := nativeInputValue(json.RawMessage(tc.input), tc.kind)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s/%s: %v %v", tc.input, tc.kind, got, err)
		}
	}
	for _, input := range []string{`"0123"`, `"true"`, "true", "123", "null", "{}", "[]"} {
		got, err := nativeInputValue(json.RawMessage(input), "Dynamic")
		if err != nil {
			t.Fatal(err)
		}
		if input == "null" {
			if got != nil {
				t.Fatal("null must remain null")
			}
			continue
		}
		typed := got.(chcol.Dynamic)
		if strings.HasPrefix(input, `"`) && typed.Type() != "String" {
			t.Fatal("string inferred as other type")
		}
	}
	if _, err := nativeInputValue(json.RawMessage("256"), "UInt8"); err == nil {
		t.Fatal("overflow must fail")
	}
	if _, err := nativeInputValue(json.RawMessage("18446744073709551616"), "Dynamic"); err == nil {
		t.Fatal("integer precision loss must fail")
	}
}

func TestNativeScalarAndContainerRoundTrip(t *testing.T) {
	columns := []schema.Column{{Name: "d", Type: "Dynamic"}, {Name: "xdr", Type: "String"}, {Name: "arr", Type: "Array(String)"}, {Name: "nullable", Type: "Nullable(Int64)"}}
	cases := []string{`{"d":null,"xdr":"AAAA","arr":["0123","true"],"nullable":null}`, `{"d":{},"xdr":"AAAA","arr":[],"nullable":-2}`, `{"d":[],"xdr":"AAAA","arr":[],"nullable":0}`, `{"d":[true,1,"1",null,{},[],{"n":null}],"xdr":"AAAA","arr":[],"nullable":1}`}
	for _, input := range cases {
		encoded, err := encodeNativeRows(columns, []byte(input))
		if err != nil {
			t.Fatal(err)
		}
		if got, want := readNativeOffline(t, encoded), decodeJSON(t, []byte(input)); !reflect.DeepEqual(got, want) {
			t.Fatalf("round trip changed %s: %#v", input, got)
		}
	}
}

func readNativeOffline(t *testing.T, data []byte) map[string]any {
	t.Helper()
	binary, err := exec.LookPath("clickhouse-local")
	if err != nil {
		t.Skip("real Native decoder gate requires installed clickhouse-local")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--no-system-tables", "--max_threads", "2", "--max_memory_usage", "536870912", "--input-format", "Native", "--query", "SELECT * FROM table SETTINGS output_format_json_quote_64bit_integers=0 FORMAT JSONEachRow")
	cmd.Stdin = bytes.NewReader(data)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Native decoder: %v %s", err, output)
	}
	return decodeJSON(t, output).(map[string]any)
}

func decodeJSON(t *testing.T, data []byte) any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
