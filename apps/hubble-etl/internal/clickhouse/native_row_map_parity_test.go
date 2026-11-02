package clickhouse

import (
	"bytes"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Compare complete Native blocks, not selected values or output lengths. The
// baseline shares only the unchanged splitter, constants and value converters.
func compareNativeRowMap(t *testing.T, columns []schema.Column, rows []byte, wantError bool) error {
	t.Helper()
	input := bytes.Clone(rows)
	baseline, baselineErr := encodeNativeRowsParallelRowMapBaseline(columns, rows)
	if !bytes.Equal(input, rows) {
		t.Fatal("baseline mutated input")
	}
	actual, actualErr := encodeNativeRowsParallel(columns, rows)
	if !bytes.Equal(input, rows) {
		t.Fatal("candidate mutated input")
	}
	if (baselineErr != nil) != wantError || (actualErr != nil) != wantError {
		t.Fatalf("want error=%v; baseline=%v; candidate=%v", wantError, baselineErr, actualErr)
	}
	for left, right := baselineErr, actualErr; left != nil || right != nil; left, right = errors.Unwrap(left), errors.Unwrap(right) {
		if left == nil || right == nil || reflect.TypeOf(left) != reflect.TypeOf(right) || left.Error() != right.Error() {
			t.Fatalf("error chain differs: baseline=%T %v; candidate=%T %v", left, left, right, right)
		}
	}
	if !bytes.Equal(baseline, actual) || (baseline == nil) != (actual == nil) {
		t.Fatalf("complete Native bytes differ: baseline=%d candidate=%d", len(baseline), len(actual))
	}
	return actualErr
}

func TestNativeRowMapParity(t *testing.T) {
	ordinary := []schema.Column{
		{Name: "u", Type: "UInt64"},
		{Name: "s", Type: "String"},
		{Name: "n", Type: "Nullable(String)"},
		{Name: "a", Type: "Dynamic"},
		{Name: "d", Type: "Dynamic"},
	}
	numeric := []schema.Column{
		{Name: "u", Type: "UInt64"},
		{Name: "i", Type: "Int64"},
		{Name: "f", Type: "Float64"},
		{Name: "s", Type: "String"},
		{Name: "d", Type: "Dynamic"},
	}
	timestamps := []schema.Column{{Name: "t", Type: "DateTime64(9, 'UTC')"}}
	arrays := []schema.Column{{Name: "a", Type: "Array(String)"}}
	cases := []struct {
		name    string
		columns []schema.Column
		rows    string
		wantErr bool
	}{
		{"empty input", ordinary, "", false},
		{"whitespace input", ordinary, " \n\t", false},
		{"empty objects", ordinary, "{}\n{}\n", false},
		{"stale keys become missing", ordinary, `{"u":7,"s":"present","n":"present","a":["present"],"d":{"only":"present"}}` + "\n{}\n", false},
		{"present then null fields", ordinary, `{"u":7,"s":"present","n":"present","a":["present"],"d":{"only":"present"}}` + "\n" + `{"u":null,"s":null,"n":null,"a":null,"d":null}`, false},
		{"present then empty fields", ordinary, `{"u":7,"s":"present","n":"present","a":["present"],"d":{"only":"present"}}` + "\n" + `{"u":0,"s":"","n":"","a":[],"d":{}}`, false},
		{"missing then present", ordinary, "{}\n" + `{"u":9,"s":"next","a":["a","9007199254740993"],"d":[]}`, false},
		{"duplicate last wins", ordinary, `{"s":"first","s":"last","u":"invalid","u":7}`, false},
		{"duplicate last null", ordinary, `{"s":"first","s":null,"u":7,"u":null,"d":{"only":1},"d":null}`, false},
		{"duplicate null then value", ordinary, `{"s":null,"s":"last","u":null,"u":8,"d":null,"d":{"only":2}}`, false},
		{"adjacent objects", ordinary, `{"s":"first"} {"s":"second"}`, false},
		{"missing required array rejected", arrays, `{}`, true},
		{"null required array rejected", arrays, `{"a":null}`, true},
		{"array becomes missing rejected", arrays, "{\"a\":[\"first\"]}\n{}", true},
		{"array becomes null rejected", arrays, "{\"a\":[\"first\"]}\n{\"a\":null}", true},
		{"array becomes empty", arrays, "{\"a\":[\"first\"]}\n{\"a\":[]}", false},
		{"one unknown key", ordinary, `{"s":"first"}` + "\n" + `{"unexpected":true}`, true},
		{"null object", ordinary, `null`, true},
		{"present then null object", ordinary, `{"s":"first"}` + "\nnull", true},
		{"array object", ordinary, `[]`, true},
		{"string object", ordinary, `"not an object"`, true},
		{"number object", ordinary, `1`, true},
		{"bool object", ordinary, `true`, true},
		{"malformed first row", ordinary, `{"s":`, true},
		{"malformed next row", ordinary, `{"s":"first"}` + "\n" + `{"s":`, true},
		{"trailing garbage", ordinary, `{"s":"first"} garbage`, true},
		{"trailing incomplete object", ordinary, `{"s":"first"} {`, true},
		{"trailing scalar", ordinary, `{"s":"first"} true`, true},
		// One key per Dynamic map avoids irrelevant Go map iteration ordering.
		{"nested Dynamic", ordinary, `{"d":{"only":[{"nested":[null,true,"9007199254740993",18446744073709551615,-9223372036854775808,1e0,-0.0]},[],{}]}}` + "\n" + `{"d":[["next"],{"only":false}]}`, false},
		{"escaped strings", ordinary, `{"s":"\u03bb\u0000\"\\","a":["","\u03bb"],"d":"18446744073709551615"}`, false},
		{"integer boundaries", numeric, `{"u":18446744073709551615,"i":-9223372036854775808,"f":-0.0,"s":"9007199254740993","d":18446744073709551615}` + "\n" + `{"u":9007199254740993,"i":9223372036854775807,"f":1e0,"s":"18446744073709551615","d":"18446744073709551615"}`, false},
		{"float normalization", numeric, `{"u":0,"i":0,"f":1.25,"s":"","d":1e0}` + "\n" + `{"f":-0.0,"d":-0.0}`, false},
		{"uint overflow", numeric, `{"u":18446744073709551616}`, true},
		{"int overflow", numeric, `{"i":9223372036854775808}`, true},
		{"int underflow", numeric, `{"i":-9223372036854775809}`, true},
		{"Dynamic integer overflow", numeric, `{"d":18446744073709551616}`, true},
		{"quoted numeric UInt64 rejected", numeric, `{"u":"9007199254740993"}`, true},
		{"float overflow", numeric, `{"f":1e400}`, true},
		{"timestamp precision and offset", timestamps, `{"t":"2026-10-31T12:34:56.123456789Z"}` + "\n" + `{"t":"2026-10-31T12:34:56.987654321+05:30"}`, false},
		{"invalid timestamp", timestamps, `{"t":"not-a-time"}`, true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			compareNativeRowMap(t, test.columns, []byte(test.rows), test.wantErr)
		})
	}
}

func TestNativeRowMapOwnership(t *testing.T) {
	columns := []schema.Column{{Name: "s", Type: "String"}, {Name: "d", Type: "Dynamic"}}
	for _, encoder := range []struct {
		name string
		call func([]schema.Column, []byte) ([]byte, error)
	}{
		{"baseline", encodeNativeRowsParallelRowMapBaseline},
		{"candidate", encodeNativeRowsParallel},
	} {
		t.Run(encoder.name, func(t *testing.T) {
			input := []byte("{\"s\":\"first\",\"d\":{\"only\":[\"9007199254740993\",null]}}\n{}\n")
			original := bytes.Clone(input)
			first, err := encoder.call(columns, input)
			if err != nil || !bytes.Equal(input, original) {
				t.Fatalf("initial encode: error=%v input changed=%v", err, !bytes.Equal(input, original))
			}
			expected := bytes.Clone(first)
			for i := range input {
				input[i] = 'x'
			}
			if !bytes.Equal(first, expected) {
				t.Fatal("output aliases input")
			}
			copy(input, original)
			second, err := encoder.call(columns, input)
			if err != nil || !bytes.Equal(second, expected) {
				t.Fatalf("repeated encode differs: %v", err)
			}
			second[0] ^= 0xff
			if !bytes.Equal(first, expected) {
				t.Fatal("output reused across calls")
			}
			first[0] ^= 0xff
			if !bytes.Equal(input, original) {
				t.Fatal("input aliases output")
			}
		})
	}
}

func TestNativeRowMapFirstErrorSegmentOrder(t *testing.T) {
	if nativeParallelRows != 32768 || nativeParallelBytes != 64<<20 || nativeParallelWorkers != 4 {
		t.Fatal("accepted chunk geometry or four-worker cap changed")
	}
	columns := []schema.Column{{Name: "u", Type: "UInt64"}, {Name: "t", Type: "DateTime64(9, 'UTC')"}}
	first := "{\"u\":18446744073709551616,\"t\":\"2026-10-31T00:00:00Z\"}\n"
	good := "{\"u\":0,\"t\":\"2026-10-31T00:00:00Z\"}\n"
	last := "{\"u\":0,\"t\":\"second-segment-invalid-time\"}\n"
	rows := []byte(first + strings.Repeat(good, 32767) + last)
	segments := splitNativeJSONRows(rows, nativeParallelRows, nativeParallelBytes)
	if len(segments) != 2 || bytes.Count(segments[0], []byte{'\n'}) != 32768 || bytes.Count(segments[1], []byte{'\n'}) != 1 {
		t.Fatal("fixture must contain 32769 rows in two accepted segments")
	}
	err := compareNativeRowMap(t, columns, rows, true)
	if !strings.Contains(err.Error(), "row 0 column u:") {
		t.Fatalf("did not select first segment error: %v", err)
	}
	err = compareNativeRowMap(t, columns, segments[1], true)
	if !strings.Contains(err.Error(), "row 0 column t:") {
		t.Fatalf("second segment must fail independently: %v", err)
	}
}
