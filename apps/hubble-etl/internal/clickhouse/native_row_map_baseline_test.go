package clickhouse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	chproto "github.com/ClickHouse/ch-go/proto"
	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	native "github.com/ClickHouse/clickhouse-go/v2/lib/proto"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Immutable baseline from cb67b3ef02c679e97ff00013aea71935c68e4b6a:
// native_input.go SHA256 ba341577c6e3d2f2d920a4f8206a1fe121e7803287f95945e744c1d0ca45c3a9.
// native_parallel.go SHA256 53c442ff6d55dc4008073ec95d7641cef51542fb07bc896f64cdd75ec1d1f937.
// Function bodies have identifier-only adaptations: rename the encoder and the
// primary scheduler, and point its two encoder calls at the baseline encoder.
// The accepted constants, splitter and value converters are shared unchanged.
func encodeNativeRowsRowMapBaseline(columns []schema.Column, rows []byte) ([]byte, error) {
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
	values := make([]any, len(columns))
	defer clear(values)
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

func encodeNativeRowsParallelRowMapBaseline(columns []schema.Column, rows []byte) ([]byte, error) {
	segments := splitNativeJSONRows(rows, nativeParallelRows, nativeParallelBytes)
	if len(segments) <= 1 {
		return encodeNativeRowsRowMapBaseline(columns, rows)
	}
	type result struct {
		data []byte
		err  error
	}
	results := make([]result, len(segments))
	jobs := make(chan int)
	var workers sync.WaitGroup
	workers.Add(min(nativeParallelWorkers, len(segments)))
	for range min(nativeParallelWorkers, len(segments)) {
		go func() {
			defer workers.Done()
			for index := range jobs {
				results[index].data, results[index].err = encodeNativeRowsRowMapBaseline(columns, segments[index])
			}
		}()
	}
	for index := range segments {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	// Observe errors only after all workers join, and always in segment order.
	blocks := make([][]byte, len(results))
	for index, result := range results {
		if result.err != nil {
			return nil, result.err
		}
		blocks[index] = result.data
	}
	return bytes.Join(blocks, nil), nil
}
