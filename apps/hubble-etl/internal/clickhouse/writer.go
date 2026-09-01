package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

type BatchIdentity struct {
	ID           string
	SourceSHA256 string
	StartLedger  uint32
	EndLedger    uint32
}

type WriterLimits struct {
	MaximumRows  int
	MaximumBytes int
}

type BatchWriter struct {
	client     *Client
	identity   BatchIdentity
	limits     WriterLimits
	ingestedAt time.Time
	tables     map[string]*tableBuffer
	totalRows  uint64
}

type tableBuffer struct {
	body       bytes.Buffer
	chunk      uint64
	nextRow    uint64
	bufferRows int
}

func NewBatchWriter(
	client *Client,
	identity BatchIdentity,
	limits WriterLimits,
) (*BatchWriter, error) {
	if client == nil {
		return nil, fmt.Errorf("ClickHouse client is required")
	}
	if !uuidPattern.MatchString(identity.ID) ||
		!digestPattern.MatchString(identity.SourceSHA256) ||
		identity.StartLedger == 0 || identity.EndLedger < identity.StartLedger {
		return nil, fmt.Errorf("invalid immutable batch identity")
	}
	if limits.MaximumRows < 1 || limits.MaximumBytes < 1024 {
		return nil, fmt.Errorf("invalid ClickHouse writer limits")
	}
	return &BatchWriter{
		client:     client,
		identity:   identity,
		limits:     limits,
		ingestedAt: time.Now().UTC(),
		tables:     make(map[string]*tableBuffer, len(schema.Datasets())),
	}, nil
}

func (w *BatchWriter) Emit(
	ctx context.Context,
	dataset string,
	ledgerSequence uint32,
	row any,
) error {
	if _, ok := schema.Lookup(dataset); !ok {
		return fmt.Errorf("unknown Hubble dataset %q", dataset)
	}
	if ledgerSequence < w.identity.StartLedger ||
		ledgerSequence > w.identity.EndLedger {
		return fmt.Errorf(
			"%s ledger %d is outside immutable batch [%d,%d]",
			dataset,
			ledgerSequence,
			w.identity.StartLedger,
			w.identity.EndLedger,
		)
	}
	table := w.tables[dataset]
	if table == nil {
		table = &tableBuffer{}
		w.tables[dataset] = table
	}
	encoded, err := encodeRow(
		row,
		w.identity,
		ledgerSequence,
		table.nextRow,
		w.ingestedAt,
	)
	if err != nil {
		return fmt.Errorf("encode %s row: %w", dataset, err)
	}
	table.body.Write(encoded)
	table.body.WriteByte('\n')
	table.nextRow++
	table.bufferRows++
	w.totalRows++
	if table.bufferRows >= w.limits.MaximumRows ||
		table.body.Len() >= w.limits.MaximumBytes {
		return w.flushTable(ctx, dataset, table)
	}
	return nil
}

func (w *BatchWriter) Flush(ctx context.Context) error {
	for _, dataset := range schema.Datasets() {
		if table := w.tables[dataset.Name]; table != nil {
			if err := w.flushTable(ctx, dataset.Name, table); err != nil {
				return err
			}
		}
	}
	return nil
}

func (w *BatchWriter) TotalRows() uint64 {
	return w.totalRows
}

func (w *BatchWriter) flushTable(
	ctx context.Context,
	dataset string,
	table *tableBuffer,
) error {
	if table.bufferRows == 0 {
		return nil
	}
	token := w.identity.ID + ":" + dataset + ":" + strconv.FormatUint(table.chunk, 10)
	if err := w.client.Insert(ctx, dataset, token, table.body.Bytes()); err != nil {
		return err
	}
	table.body.Reset()
	table.bufferRows = 0
	table.chunk++
	return nil
}

func encodeRow(
	row any,
	identity BatchIdentity,
	ledgerSequence uint32,
	rowNumber uint64,
	ingestedAt time.Time,
) ([]byte, error) {
	encoded, err := json.Marshal(row)
	if err != nil {
		return nil, err
	}
	if len(encoded) < 2 || encoded[0] != '{' || encoded[len(encoded)-1] != '}' {
		return nil, fmt.Errorf("official stellar-etl row is not a JSON object")
	}
	metadata, err := json.Marshal(struct {
		BatchID      string `json:"_batch_id"`
		SourceSHA256 string `json:"_source_sha256"`
		Ledger       uint32 `json:"_ledger_sequence"`
		RowNumber    uint64 `json:"_row_number"`
		IngestedAt   string `json:"_ingested_at"`
	}{
		BatchID:      identity.ID,
		SourceSHA256: identity.SourceSHA256,
		Ledger:       ledgerSequence,
		RowNumber:    rowNumber,
		IngestedAt:   ingestedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, err
	}
	result := make([]byte, 0, len(encoded)+len(metadata))
	result = append(result, encoded[:len(encoded)-1]...)
	if len(encoded) > 2 {
		result = append(result, ',')
	}
	result = append(result, metadata[1:]...)
	return result, nil
}
