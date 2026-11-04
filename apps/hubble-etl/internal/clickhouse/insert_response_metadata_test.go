package clickhouse

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func insertResponseTestUint64(value uint64) *uint64 { return &value }

func TestParseInsertResponseMetadata(t *testing.T) {
	summary := func(raw string) http.Header {
		return http.Header{"X-ClickHouse-Summary": []string{raw}}
	}
	all := insertResponseMetadata{
		elapsedNanoseconds: insertResponseTestUint64(12),
		writtenRows:        insertResponseTestUint64(3),
		writtenBytes:       insertResponseTestUint64(24),
	}
	zero := insertResponseMetadata{
		elapsedNanoseconds: insertResponseTestUint64(0),
		writtenRows:        insertResponseTestUint64(0),
		writtenBytes:       insertResponseTestUint64(0),
	}
	prefix, suffix := `{"elapsed_ns":1,"unknown":"`, `"}`
	exactBound := prefix + strings.Repeat("x", 4096-len(prefix)-len(suffix)) + suffix
	cases := []struct {
		name   string
		header http.Header
		want   insertResponseMetadata
	}{
		{"numeric", summary(`{"elapsed_ns":12,"written_rows":3,"written_bytes":24}`), all},
		{"quoted", summary(`{"elapsed_ns":"12","written_rows":"3","written_bytes":"24"}`), all},
		{"zero-is-known", summary(`{"elapsed_ns":0,"written_rows":"0","written_bytes":"000"}`), zero},
		{"uint64-maximum", summary(`{"elapsed_ns":18446744073709551615,"written_rows":"18446744073709551615"}`), insertResponseMetadata{
			elapsedNanoseconds: insertResponseTestUint64(^uint64(0)),
			writtenRows:        insertResponseTestUint64(^uint64(0)),
		}},
		{"missing-fields", summary(`{"written_rows":7}`), insertResponseMetadata{writtenRows: insertResponseTestUint64(7)}},
		{"mixed-invalid", summary(`{"elapsed_ns":null,"written_rows":"3","written_bytes":{}}`), insertResponseMetadata{writtenRows: insertResponseTestUint64(3)}},
		{"invalid-rows-preserves-other-fields", summary(`{"elapsed_ns":12,"written_rows":true,"written_bytes":"24"}`), insertResponseMetadata{elapsedNanoseconds: insertResponseTestUint64(12), writtenBytes: insertResponseTestUint64(24)}},
		{"whitespace", summary(" \n{ \"elapsed_ns\" : 12, \"written_rows\" : 3, \"written_bytes\" : 24 }\t"), all},
		{"unknown-values-ignored", summary(`{"elapsed_ns":1,"other":{"written_rows":[1,true,null]},"other":"ignored"}`), insertResponseMetadata{elapsedNanoseconds: insertResponseTestUint64(1)}},
		{"exact-4096-byte-bound", summary(exactBound), insertResponseMetadata{elapsedNanoseconds: insertResponseTestUint64(1)}},
		{"oversized", summary(exactBound + " "), insertResponseMetadata{}},
		{"empty-object", summary(`{}`), insertResponseMetadata{}},
		{"missing-header", nil, insertResponseMetadata{}},
		{"empty-values", http.Header{"X-ClickHouse-Summary": nil}, insertResponseMetadata{}},
		{"empty-header", summary(""), insertResponseMetadata{}},
		{"duplicate-headers", http.Header{"X-ClickHouse-Summary": []string{`{"elapsed_ns":1}`, `{"written_rows":2}`}}, insertResponseMetadata{}},
		{"case-variant-duplicate-headers", http.Header{"x-clickhouse-summary": []string{`{"elapsed_ns":1}`}, "X-ClickHouse-Summary": []string{`{"written_rows":2}`}}, insertResponseMetadata{}},
		{"lowercase-header", http.Header{"x-clickhouse-summary": []string{`{"written_rows":7}`}}, insertResponseMetadata{writtenRows: insertResponseTestUint64(7)}},
		{"duplicate-elapsed", summary(`{"elapsed_ns":1,"elapsed_ns":2,"written_rows":9}`), insertResponseMetadata{}},
		{"duplicate-rows-after-invalid", summary(`{"written_rows":null,"written_rows":2,"elapsed_ns":9}`), insertResponseMetadata{}},
		{"duplicate-bytes", summary(`{"elapsed_ns":1,"written_bytes":2,"written_bytes":3}`), insertResponseMetadata{}},
		{"escaped-duplicate-key", summary(`{"elapsed_ns":1,"\u0065lapsed_ns":2}`), insertResponseMetadata{}},
		{"malformed", summary(`{"elapsed_ns":1`), insertResponseMetadata{}},
		{"malformed-unknown", summary(`{"elapsed_ns":1,"unknown":[}`), insertResponseMetadata{}},
		{"trailing-object", summary(`{"elapsed_ns":1} {}`), insertResponseMetadata{}},
		{"trailing-token", summary(`{"elapsed_ns":1} true`), insertResponseMetadata{}},
		{"array", summary(`[{"elapsed_ns":1}]`), insertResponseMetadata{}},
		{"null", summary(`null`), insertResponseMetadata{}},
		{"scalar", summary(`7`), insertResponseMetadata{}},
		{"invalid-json-number", summary(`{"elapsed_ns":01,"written_rows":9}`), insertResponseMetadata{}},
		{"invalid-utf8", summary("{\"elapsed_ns\":1,\"unknown\":\"" + string([]byte{255}) + "\"}"), insertResponseMetadata{}},
	}
	for _, invalid := range []struct{ name, raw string }{
		{"negative", `-1`},
		{"negative-zero", `-0`},
		{"decimal", `1.0`},
		{"exponent", `1e2`},
		{"quoted-sign", `"+1"`},
		{"quoted-negative", `"-1"`},
		{"quoted-exponent", `"1e2"`},
		{"quoted-space", `"1 2"`},
		{"escaped-digit", `"\u0031"`},
		{"non-ascii-digit", `"١"`},
		{"empty-string", `""`},
		{"null", `null`},
		{"boolean", `true`},
		{"array", `[]`},
		{"object", `{}`},
		{"numeric-overflow", `18446744073709551616`},
		{"quoted-overflow", `"18446744073709551616"`},
	} {
		cases = append(cases, struct {
			name   string
			header http.Header
			want   insertResponseMetadata
		}{
			"individually-invalid/" + invalid.name,
			summary(`{"elapsed_ns":` + invalid.raw + `,"written_rows":9}`),
			insertResponseMetadata{writtenRows: insertResponseTestUint64(9)},
		})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.header.Clone()
			got := parseInsertResponseMetadata(tc.header)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("metadata differs: got %#v, want %#v", got, tc.want)
			}
			if !reflect.DeepEqual(tc.header, before) {
				t.Fatal("parser mutated response headers")
			}
		})
	}
}
