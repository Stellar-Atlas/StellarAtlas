package clickhouse

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestAppendEncodedRowMatchesLegacyBytes(t *testing.T) {
	identity := BatchIdentity{ID: "batch<>&", SourceSHA256: "source\u2028"}
	ingested := time.Date(2026, 10, 30, 12, 0, 0, 123456789, time.FixedZone("fixture", 19800))
	cases := []struct {
		name string
		row  any
	}{
		{"empty", struct{}{}},
		{"dynamic", map[string]any{"details": map[string]any{
			"array":               []any{nil, true, "<>&\u2028", json.Number("18446744073709551615")},
			"json-looking-string": `{"preserve":"as string"}`,
			"invalid-utf8":        string([]byte{0xff, 'x'}),
		}}},
		{"raw-duplicate-members", json.RawMessage(`{"x":1,"x":2}`)},
		{"large-uint", map[string]any{"x": uint64(math.MaxUint64)}},
		{"nil", nil},
		{"array", []int{1, 2}},
		{"invalid-raw", json.RawMessage(`{"x":`)},
		{"unsupported", map[string]any{"x": func() {}}},
		{"nan", map[string]any{"x": math.NaN()}},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			want, oldErr := encodeRow(item.row, identity, math.MaxUint32, math.MaxUint64, ingested)
			body := bytes.NewBufferString("previous-row\n")
			got, newErr := appendEncodedRow(body, item.row, identity, math.MaxUint32, math.MaxUint64, ingested)
			if oldErr != nil {
				if newErr == nil || newErr.Error() != oldErr.Error() {
					t.Fatalf("error mismatch: old=%v new=%v", oldErr, newErr)
				}
				if body.String() != "previous-row\n" {
					t.Fatal("failed row changed prior buffer bytes")
				}
				return
			}
			if newErr != nil || !bytes.Equal(got, want) {
				t.Fatalf("row bytes differ: %v\nold=%s\nnew=%s", newErr, want, got)
			}
			if !bytes.Equal(body.Bytes(), append(append([]byte("previous-row\n"), want...), '\n')) {
				t.Fatal("table buffer framing changed")
			}
		})
	}
}
