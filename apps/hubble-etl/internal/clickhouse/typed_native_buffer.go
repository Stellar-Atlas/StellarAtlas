package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	chproto "github.com/ClickHouse/ch-go/proto"
	"github.com/ClickHouse/clickhouse-go/v2/lib/column"
	native "github.com/ClickHouse/clickhouse-go/v2/lib/proto"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
	"net/url"
	"strings"
	"time"
)

type typedNativeBuffer struct {
	table                                   string
	columns                                 []schema.Column
	active                                  *native.Block
	blocks                                  [][]byte
	activeBytes, activeWeight, encodedBytes int
	encodeElapsed                           time.Duration
	values                                  []any
}
type typedNativeChunk struct {
	table        string
	blocks       [][]byte
	encodedBytes int
	preEncode    time.Duration
}

func typedNativeBlockSplit(rows, oldBytes, nextBytes int) bool {
	return rows > 0 && (rows >= nativeParallelRows || oldBytes+nextBytes > nativeParallelBytes)
}
func (b *typedNativeBuffer) reservation() int { return 2*b.encodedBytes + 8192*(len(b.blocks)+1) }
func (b *typedNativeBuffer) finishBlock() error {
	if b.active == nil {
		return nil
	}
	started := time.Now()
	defer func() { b.encodeElapsed += time.Since(started) }()
	buffer := new(chproto.Buffer)
	if err := b.active.Encode(buffer, 0); err != nil {
		return err
	}
	// Own exact immutable bytes, not the driver's geometrically grown workspace.
	body := bytes.Clone(buffer.Buf)
	b.blocks = append(b.blocks, body)
	b.encodedBytes += len(body)
	b.active = nil
	b.activeBytes = 0
	b.activeWeight = 0
	return nil
}
func (b *typedNativeBuffer) append(values []any, jsonBytes, weight int) error {
	if b.active != nil && typedNativeBlockSplit(b.active.Rows(), b.activeBytes, jsonBytes) {
		if err := b.finishBlock(); err != nil {
			return err
		}
	}
	if b.active == nil {
		b.active = native.NewBlock()
		b.active.ServerContext.Timezone = time.UTC
		for _, c := range b.columns {
			if err := b.active.AddColumn(c.Name, column.Type(c.Type)); err != nil {
				return err
			}
		}
	}
	if err := b.active.Append(values...); err != nil {
		return err
	}
	b.activeBytes += jsonBytes
	// Only one expanded driver block is owned, bounded by original row/JSON limits.
	b.activeWeight += max(weight*4, jsonBytes*16+4096)
	return nil
}
func (w *BatchWriter) appendTypedNative(dataset string, table *tableBuffer, ledger uint32, encoded []byte) error {
	if w.pendingInsertError != nil {
		return w.pendingInsertError
	}
	columns, _, _, err := typedNativeSchema(dataset)
	if err != nil {
		return err
	}
	p := table.nativePrepared
	table.nativePrepared = nil
	if p != nil && (p.dataset != dataset || len(p.values) != len(columns)-5) {
		return fmt.Errorf("prepared Native dataset/field mismatch for %s", dataset)
	}
	if table.nativeBuffer == nil {
		table.nativeBuffer = &typedNativeBuffer{table: dataset, columns: columns}
	}
	if table.nativeBuffer.table != dataset {
		return fmt.Errorf("Native buffer dataset mismatch")
	}
	if len(table.nativeBuffer.values) != len(columns) {
		table.nativeBuffer.values = make([]any, len(columns))
	}
	values := table.nativeBuffer.values
	// The driver's Block.Append passes individual interface values to columns;
	// it does not retain this argument slice. Clear it even on failed appends.
	defer clear(values)
	if p != nil {
		copy(values, p.values)
		n := len(p.values)
		values[n], values[n+1], values[n+2], values[n+3], values[n+4] = w.identity.ID, w.identity.SourceSHA256, ledger, table.nextRow, w.ingestedAt
	} else {
		var row map[string]json.RawMessage
		if err := json.Unmarshal(encoded, &row); err != nil {
			return err
		}
		known := make(map[string]struct{}, len(columns))
		for i, c := range columns {
			known[c.Name] = struct{}{}
			v, err := nativeInputValue(row[c.Name], c.Type)
			if err != nil {
				return fmt.Errorf("%s column %s: %w", dataset, c.Name, err)
			}
			values[i] = v
		}
		for name := range row {
			if _, ok := known[name]; !ok {
				return fmt.Errorf("unknown %s column %s", dataset, name)
			}
		}
	}
	return table.nativeBuffer.append(values, len(encoded)+1, p.RetainedBytes())
}
func (w *BatchWriter) failTypedNative(table *tableBuffer, err error) error {
	if table.nativeBuffer != nil {
		w.insertTimings.nativeEncode += table.nativeBuffer.encodeElapsed
		table.nativeBuffer.encodeElapsed = 0
	}
	w.rememberInsertError(err)
	return err
}
func detachTypedNative(table *tableBuffer) *typedNativeChunk {
	if table.nativeBuffer == nil {
		return nil
	}
	b := table.nativeBuffer
	table.nativeBuffer = nil
	return &typedNativeChunk{table: b.table, blocks: b.blocks, encodedBytes: b.encodedBytes, preEncode: b.encodeElapsed}
}
func (chunk *typedNativeChunk) payload(ctx context.Context) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	body := bytes.Join(chunk.blocks, nil)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return body, nil
}
func (c *Client) insertEncodedNative(ctx context.Context, table, token string, chunk *typedNativeChunk, timings *insertTimings) error {
	if (table != "history_effects" && table != "history_contract_events" && table != "history_operations") || chunk == nil || chunk.table != table || len(chunk.blocks) == 0 || !tokenPattern.MatchString(token) {
		return fmt.Errorf("invalid typed Native insertion")
	}
	if table == "history_effects" {
		token += ":typed-effects-native-v1"
	} else if table == "history_contract_events" {
		token += ":typed-events-native-v1"
	} else {
		if !c.singleCopyOperations {
			return fmt.Errorf("typed operations requires single-copy operations")
		}
		// Same physical columns, values, chunk boundaries and token as generic Native.
		token += ":single-copy-v1:native-v1"
	}
	if !tokenPattern.MatchString(token) {
		return fmt.Errorf("versioned insertion token too long")
	}
	if timings != nil {
		timings.encoderAttempted = true
	}
	started := time.Now()
	rows, err := chunk.payload(ctx)
	if timings != nil {
		timings.nativeEncode += time.Since(started)
	}
	if err != nil {
		return err
	}
	columnList := ""
	if table == "history_operations" {
		plan, err := typedOperationsSchema()
		if err != nil {
			return err
		}
		names := make([]string, len(plan.columns))
		for i, c := range plan.columns {
			names[i] = quoted(c.Name)
		}
		columnList = " (" + strings.Join(names, ", ") + ")"
	}
	query := "INSERT INTO " + quoted(c.database) + "." + quoted(table) + columnList + " SETTINGS async_insert=0, insert_deduplication_token={token:String}, date_time_input_format='best_effort' FORMAT Native"
	started = time.Now()
	_, err = c.executeTimed(ctx, query, url.Values{"param_token": []string{token}}, rows, timings)
	if timings != nil {
		timings.request += time.Since(started)
	}
	if err != nil {
		return fmt.Errorf("insert %s: %w", table, err)
	}
	return nil
}
