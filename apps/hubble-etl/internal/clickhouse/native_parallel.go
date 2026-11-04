package clickhouse

import (
	"bytes"
	"sync"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

const (
	nativeParallelRows    = 32768
	nativeParallelBytes   = 64 << 20
	nativeParallelWorkers = 4
)

// encodeNativeRowsParallel bounds production Native conversion to four workers.
// The caller owns immutable JSONEachRow input. Every worker uses the unchanged
// legacy codec on a disjoint, capacity-limited slice; Native blocks retain order.
func encodeNativeRowsParallel(columns []schema.Column, rows []byte) ([]byte, error) {
	segments := splitNativeJSONRows(rows, nativeParallelRows, nativeParallelBytes)
	if len(segments) <= 1 {
		return encodeNativeRows(columns, rows)
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
				results[index].data, results[index].err = encodeNativeRows(columns, segments[index])
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

// A single oversized JSON line is necessarily indivisible. Apart from that
// exception, neither limit is exceeded; newlines and JSON bytes stay untouched.
// Blank lines conservatively count toward the line/row budget.
func splitNativeJSONRows(rows []byte, maxRows, maxBytes int) [][]byte {
	var segments [][]byte
	start, offset, count := 0, 0, 0
	for offset < len(rows) {
		end := len(rows)
		if newline := bytes.IndexByte(rows[offset:], '\n'); newline >= 0 {
			end = offset + newline + 1
		}
		if offset > start && (count >= maxRows || end-start > maxBytes) {
			segments = append(segments, rows[start:offset:offset])
			start, count = offset, 0
		}
		count++
		offset = end
	}
	if start < len(rows) {
		segments = append(segments, rows[start:len(rows):len(rows)])
	}
	return segments
}
