package clickhouse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"time"

	chproto "github.com/ClickHouse/ch-go/proto"
	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	native "github.com/ClickHouse/clickhouse-go/v2/lib/proto"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Native encoding bypasses lossy JSON inference while retaining the existing
// HTTP connection pool, immutable row identities, and batch-sized INSERTs.
// The official driver owns the wire codec; this adapter only supplies typed values.
func encodeNativeRows(columns []schema.Column, rows []byte) ([]byte, error) {
	block := native.NewBlock()
	block.ServerContext.Timezone = time.UTC
	for _, col := range columns {
		if err := block.AddColumn(col.Name, column.Type(col.Type)); err != nil {
			return nil, err
		}
	}
	known := make(map[string]struct{}, len(columns))
	for _, col := range columns {
		known[col.Name] = struct{}{}
	}
	decoder := json.NewDecoder(bytes.NewReader(rows))
	for rowIndex := 0; ; rowIndex++ {
		var row map[string]json.RawMessage
		if err := decoder.Decode(&row); err == io.EOF {
			break
		} else if err != nil {
			return nil, err
		}
		if row == nil {
			return nil, fmt.Errorf("row %d is not a JSON object", rowIndex)
		}
		for name := range row {
			if _, ok := known[name]; !ok {
				return nil, fmt.Errorf("row %d has unknown column %s", rowIndex, name)
			}
		}
		values := make([]any, len(columns))
		for i, col := range columns {
			value, err := nativeInputValue(row[col.Name], col.Type)
			if err != nil {
				return nil, fmt.Errorf("row %d column %s: %w", rowIndex, col.Name, err)
			}
			values[i] = value
		}
		if err := block.Append(values...); err != nil {
			return nil, fmt.Errorf("row %d: %w", rowIndex, err)
		}
	}
	buffer := new(chproto.Buffer)
	if err := block.Encode(buffer, 0); err != nil {
		return nil, err
	}
	return buffer.Buf, nil
}

func hasDynamicColumns(columns []schema.Column) bool {
	for _, col := range columns {
		if col.Type == "Dynamic" {
			return true
		}
	}
	return false
}
