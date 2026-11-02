package clickhouse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"
)

type legacyMetadataRow struct {
	BatchID   string `json:"_batch_id"`
	SourceSHA string `json:"_source_sha256"`
	Ledger    uint32 `json:"_ledger_sequence"`
	Row       uint64 `json:"_row_number"`
	Ingested  string `json:"_ingested_at"`
}

func legacyAppend(body *bytes.Buffer, start int, batchID, sourceSHA string, at time.Time, ledger uint32, row uint64) ([]byte, error) {
	rowBytes, err := json.Marshal(legacyMetadataRow{batchID, sourceSHA, ledger, row, at.Format(time.RFC3339Nano)})
	if err != nil {
		return nil, err
	}
	data := body.Bytes()
	if len(data)-start < 2 || data[start] != '{' || data[len(data)-1] != '}' {
		return nil, fmt.Errorf("invalid body")
	}
	body.Truncate(body.Len() - 1)
	if body.Len()-start > 1 {
		body.WriteByte(',')
	}
	body.Write(rowBytes[1 : len(rowBytes)-1])
	body.WriteByte('}')
	body.WriteByte('\n')
	return body.Bytes()[start : body.Len()-1], nil
}

func TestCachedRowMetadataMatchesLegacy(t *testing.T) {
	invalidUTF8 := string([]byte{'x', 0xff, '<'})
	zones := time.FixedZone("offset", 5*60*60+30*60)
	cases := []struct {
		name      string
		batch     string
		source    string
		at        time.Time
		ledger    uint32
		row       uint64
		rowBody   string
		preceding string
	}{
		{"empty", "batch", "sha", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), 0, 0, `{}`, ""},
		{"nonempty", "batch", "sha", time.Date(2026, 1, 2, 3, 4, 5, 123456789, time.UTC), 7, 42, `{"a":1}`, ""},
		{"html-unicode", "<tag>&\u2028", "雪/sha", time.Date(2026, 1, 2, 3, 4, 5, 120000000, zones), 1, 2, `{"text":"ok"}`, ""},
		{"invalid-utf8", invalidUTF8, invalidUTF8, time.Date(2026, 1, 2, 3, 4, 5, 1, zones), 2, 3, `{}`, ""},
		{"fractional", "b", "s", time.Date(2026, 1, 2, 3, 4, 5, 1000000, time.UTC), 3, 4, `{"n":3}`, ""},
		{"maxuint32-64", "b", "s", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), math.MaxUint32, math.MaxUint64, `{}`, ""},
		{"existing-prefix", "b", "s", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), 4, 5, `{}`, "{\"prior\":true}\n"},
		{"existing-row-content", "b", "s", time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), 6, 8, `{"prior":true}`, "{\"head\":0}\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			metadata, err := newRowMetadata(tc.batch, tc.source, tc.at)
			if err != nil {
				t.Fatal(err)
			}
			var got, want bytes.Buffer
			got.WriteString(tc.preceding)
			want.WriteString(tc.preceding)
			start := got.Len()
			got.WriteString(tc.rowBody)
			want.WriteString(tc.rowBody)
			gotRow, err := appendCachedRowMetadata(&got, start, tc.ledger, tc.row, metadata)
			if err != nil {
				t.Fatal(err)
			}
			wantRow, err := legacyAppend(&want, start, tc.batch, tc.source, tc.at, tc.ledger, tc.row)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got.Bytes(), want.Bytes()) || !bytes.Equal(gotRow, wantRow) {
				t.Fatalf("cached=%q legacy=%q", got.Bytes(), want.Bytes())
			}
		})
	}
}

func BenchmarkRowMetadataAppend(b *testing.B) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 123456789, time.UTC)
	batchID, sourceSHA := "29cf59e5-0665-4875-b37d-4b7b05bd85f2", strings.Repeat("a", 64)
	metadata, err := newRowMetadata(batchID, sourceSHA, at)
	if err != nil {
		b.Fatal(err)
	}
	b.Run("legacy", func(b *testing.B) {
		var body bytes.Buffer
		for i := 0; i < b.N; i++ {
			body.Reset()
			body.WriteString(`{"payload":1}`)
			if _, err := legacyAppend(&body, 0, batchID, sourceSHA, at, 123, uint64(i)); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("cached", func(b *testing.B) {
		var body bytes.Buffer
		for i := 0; i < b.N; i++ {
			body.Reset()
			body.WriteString(`{"payload":1}`)
			if _, err := appendCachedRowMetadata(&body, 0, 123, uint64(i), metadata); err != nil {
				b.Fatal(err)
			}
		}
	})
}
