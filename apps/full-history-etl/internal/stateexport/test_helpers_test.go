package stateexport_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/writer"
)

type decodedEnvelope struct {
	Type        string                     `json:"type"`
	Version     string                     `json:"version"`
	Dataset     string                     `json:"dataset"`
	Value       map[string]json.RawMessage `json:"value"`
	RecordCount string                     `json:"recordCount"`
}

func writeParquet[T any](t *testing.T, name string, rows []T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	file, err := local.NewLocalFileWriter(path)
	if err != nil {
		t.Fatalf("create parquet fixture: %v", err)
	}
	parquetWriter, err := writer.NewParquetWriter(file, new(T), 1)
	if err != nil {
		_ = file.Close()
		t.Fatalf("create parquet fixture writer: %v", err)
	}
	parquetWriter.CompressionType = parquet.CompressionCodec_ZSTD
	parquetWriter.PageSize = 64 << 10
	parquetWriter.RowGroupSize = 1 << 20
	for index, row := range rows {
		if err := parquetWriter.Write(row); err != nil {
			_ = file.Close()
			t.Fatalf("write parquet fixture row %d: %v", index, err)
		}
	}
	if err := parquetWriter.WriteStop(); err != nil {
		_ = file.Close()
		t.Fatalf("finish parquet fixture: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close parquet fixture: %v", err)
	}
	return path
}

func decodeLines(t *testing.T, output []byte, maxLineBytes int) []decodedEnvelope {
	t.Helper()
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 64<<10), maxLineBytes+1)
	var records []decodedEnvelope
	for scanner.Scan() {
		if len(scanner.Bytes()) > maxLineBytes {
			t.Fatalf("line is %d bytes, limit is %d", len(scanner.Bytes()), maxLineBytes)
		}
		var record decodedEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("decode NDJSON line %d: %v", len(records), err)
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan NDJSON: %v", err)
	}
	return records
}

func assertRawJSON(t *testing.T, values map[string]json.RawMessage, field, expected string) {
	t.Helper()
	if got := string(values[field]); got != expected {
		t.Fatalf("%s is %s, expected %s", field, got, expected)
	}
}
