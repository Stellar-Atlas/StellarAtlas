package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
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
	TypedEffects bool
	TypedEvents  bool
	// Opt-in candidate only; requires the existing single-copy operations schema.
	TypedOperations bool
	MaximumRows     int
	MaximumBytes    int
	// Zero preserves serial INSERTs. Two opts into bounded dataset INSERT overlap.
	MaximumPendingInserts     int
	MaximumPendingInsertBytes int
	// Recovery is opt-in; ordinary importer tokens and timestamps stay unchanged.
	RecoveryNamespace  string
	RecoveryIngestedAt time.Time
}

type BatchWriter struct {
	client                *Client
	identity              BatchIdentity
	limits                WriterLimits
	ingestedAt            time.Time
	metadata              rowMetadata
	tables                map[string]*tableBuffer
	totalRows             uint64
	holderIndexRows       map[string]holderIndexUpdate
	holderIndexBytes      int
	holderIndexStagedRows uint64
	holderIndexDisabled   bool
	holderIndexFailure    error
	poolIndexRows         map[string]poolIndexUpdate
	poolIndexBytes        int
	poolIndexStagedRows   uint64
	poolIndexDisabled     bool
	flushElapsed          time.Duration
	pendingJoinElapsed    time.Duration
	insertTimings         insertTimings
	flushedRows           uint64
	flushedChunks         uint64
	flushedJSONBytes      uint64
	pendingInserts        []*pendingInsert
	pendingInsertBytes    int
	pendingInsertError    error
}

// DatasetWriteStats excludes holder/pool staging and publication queries.
// In async mode durations sum completed job service times and overlap each
// other and projection; they must not be added to wall-clock stage durations.
// Native encoding also includes typed Native blocks pre-encoded by the ordered writer.
// Permit wait precedes job service; pending join measures ordered-writer blocking.
// HTTP phases count completed event pairs only and may omit failed/early phases.
// Pool wait includes connection setup/retries, not just idle-pool contention.
// Phase sums can overlap and are not additive wall-clock stage durations.
// Rows/chunks/bytes include acknowledged dataset jobs only.
type DatasetWriteStats struct {
	FlushMilliseconds         int64  `json:"flushMilliseconds"`
	NativeEncodeMilliseconds  int64  `json:"nativeEncodeMilliseconds"`
	RequestMilliseconds       int64  `json:"requestMilliseconds"`
	PoolWaitMilliseconds      int64  `json:"poolWaitMilliseconds"`
	UploadMilliseconds        int64  `json:"uploadMilliseconds"`
	FirstByteWaitMilliseconds int64  `json:"firstByteWaitMilliseconds"`
	BodyReadMilliseconds      int64  `json:"bodyReadMilliseconds"`
	PermitWaitMilliseconds    int64  `json:"permitWaitMilliseconds"`
	PendingJoinMilliseconds   int64  `json:"pendingJoinMilliseconds"`
	Rows                      uint64 `json:"rows"`
	Chunks                    uint64 `json:"chunks"`
	JSONBytes                 uint64 `json:"jsonBytes"`
}

func (w *BatchWriter) DatasetWriteStats() DatasetWriteStats {
	return DatasetWriteStats{
		FlushMilliseconds:         w.flushElapsed.Milliseconds(),
		NativeEncodeMilliseconds:  w.insertTimings.nativeEncode.Milliseconds(),
		RequestMilliseconds:       w.insertTimings.request.Milliseconds(),
		PoolWaitMilliseconds:      w.insertTimings.poolWait.Milliseconds(),
		UploadMilliseconds:        w.insertTimings.upload.Milliseconds(),
		FirstByteWaitMilliseconds: w.insertTimings.firstByteWait.Milliseconds(),
		BodyReadMilliseconds:      w.insertTimings.bodyRead.Milliseconds(),
		PermitWaitMilliseconds:    w.insertTimings.permitWait.Milliseconds(),
		PendingJoinMilliseconds:   w.pendingJoinElapsed.Milliseconds(),
		Rows:                      w.flushedRows, Chunks: w.flushedChunks, JSONBytes: w.flushedJSONBytes,
	}
}

type tableBuffer struct {
	nativePrepared *PreparedNativeRow
	nativeBuffer   *typedNativeBuffer
	body           bytes.Buffer
	chunk          uint64
	nextRow        uint64
	bufferRows     int
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
	if limits.TypedOperations && !client.singleCopyOperations {
		return nil, fmt.Errorf("typed operations requires single-copy operations")
	}
	if limits.TypedOperations {
		// A changed official schema stays on the unchanged generic Native path.
		if _, err := typedOperationsSchema(); err != nil {
			limits.TypedOperations = false
		}
	}
	if limits.MaximumPendingInserts != 0 && limits.MaximumPendingInserts != 2 {
		return nil, fmt.Errorf("maximum pending INSERTs must be zero or two")
	}
	if limits.MaximumPendingInsertBytes < 0 {
		return nil, fmt.Errorf("invalid pending INSERT byte budget")
	}
	if limits.MaximumPendingInserts > 0 && limits.MaximumPendingInsertBytes == 0 {
		limits.MaximumPendingInsertBytes = 512 << 20
	}
	if limits.RecoveryNamespace != "" && (!tokenPattern.MatchString(limits.RecoveryNamespace) || len(limits.RecoveryNamespace) > 64 || limits.RecoveryIngestedAt.IsZero()) {
		return nil, fmt.Errorf("recovery requires a bounded namespace and fixed ingestion timestamp")
	}
	ingestedAt := time.Now().UTC()
	if limits.RecoveryNamespace != "" {
		ingestedAt = limits.RecoveryIngestedAt.UTC()
	}
	for _, dataset := range []string{"history_effects", "history_contract_events", "history_operations"} {
		if typedNativeEnabled(limits, dataset) {
			if _, _, _, err := typedNativeSchema(dataset); err != nil {
				return nil, err
			}
			if err := typedNativeTime(ingestedAt); err != nil {
				return nil, err
			}
		}
	}
	writer := &BatchWriter{
		client:     client,
		identity:   identity,
		limits:     limits,
		ingestedAt: ingestedAt,
		tables:     make(map[string]*tableBuffer, len(schema.Datasets())),
	}
	if client.holderIndexEnabled {
		writer.holderIndexRows = make(map[string]holderIndexUpdate)
		writer.poolIndexRows = make(map[string]poolIndexUpdate)
	}
	return writer, nil
}

func (w *BatchWriter) Emit(
	ctx context.Context,
	dataset string,
	ledgerSequence uint32,
	row any,
) error {
	if err := w.validateRowIdentity(dataset, ledgerSequence); err != nil {
		return err
	}
	nativeRow := row
	if w.client.singleCopyOperations && dataset == "history_operations" {
		var err error
		row, err = singleCopyOperationRow(row)
		if err != nil {
			return err
		}
	}
	table := w.tables[dataset]
	if table == nil {
		table = &tableBuffer{}
		w.tables[dataset] = table
	}
	if w.VirtualLedgerTransactions() && dataset == "ledger_transactions" {
		// Preserve the logical output/receipt count without serializing a row or
		// advancing a physical buffer/chunk. Recovery checks the source table.
		table.nextRow++
		w.totalRows++
		return nil
	}
	metadata, err := w.metadataForRows()
	if err != nil {
		return err
	}
	encoded, err := appendEncodedRow(
		&table.body,
		row,
		w.identity,
		ledgerSequence,
		table.nextRow,
		w.ingestedAt,
		metadata,
	)
	if err != nil {
		if typedNativeEnabled(w.limits, dataset) {
			w.failTypedNative(table, err)
		}
		return fmt.Errorf("encode %s row: %w", dataset, err)
	}
	if typedNativeEnabled(w.limits, dataset) {
		prepared, err := w.PrepareNativeRow(dataset, nativeRow)
		if err != nil {
			w.failTypedNative(table, err)
			return err
		}
		table.nativePrepared = prepared
	}
	return w.finishEncodedRow(ctx, dataset, ledgerSequence, table, encoded)
}

// The writer and index maps are owned by one ordered consumer, including when
// row projection and PrepareRow run in parallel.
func (w *BatchWriter) finishEncodedRow(
	ctx context.Context,
	dataset string,
	ledgerSequence uint32,
	table *tableBuffer,
	encoded []byte,
) error {
	if typedNativeEnabled(w.limits, dataset) {
		if err := w.appendTypedNative(dataset, table, ledgerSequence, encoded); err != nil {
			w.failTypedNative(table, err)
			return err
		}
	}
	if w.client.holderIndexEnabled {
		if err := w.captureHolderIndexRow(
			ctx,
			dataset,
			ledgerSequence,
			table.nextRow,
			encoded,
		); err != nil {
			w.holderIndexFailure = err
			w.holderIndexDisabled = true
			w.poolIndexDisabled = true
		}
		if w.holderIndexFailure == nil {
			if err := w.capturePoolIndexRow(ctx, dataset, ledgerSequence, table.nextRow, w.ingestedAt, w.identity, encoded); err != nil {
				w.holderIndexFailure = err
				w.poolIndexDisabled = true
			}
		}
	}
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
				_ = w.WaitPending(ctx)
				return err
			}
		}
	}
	if err := w.WaitPending(ctx); err != nil {
		return err
	}
	if w.client.holderIndexEnabled && w.holderIndexFailure == nil {
		if err := w.flushHolderIndex(ctx); err != nil {
			w.holderIndexFailure = err
		}
		if w.holderIndexFailure == nil {
			if err := w.flushPoolIndex(ctx); err != nil {
				w.holderIndexFailure = err
			}
		}
		if w.holderIndexFailure == nil {
			if err := w.client.recordHolderIndexBatch(
				ctx,
				w.identity,
				"staged",
				w.holderIndexStagedRows,
			); err != nil {
				w.holderIndexFailure = err
			}
		}
	}
	return nil
}

func (w *BatchWriter) HolderIndexRows() uint64 {
	return w.holderIndexStagedRows
}

func (w *BatchWriter) HolderIndexFailure() error {
	return w.holderIndexFailure
}

func (w *BatchWriter) PromoteHolderIndex(ctx context.Context) error {
	if err := w.WaitPending(ctx); err != nil {
		return err
	}
	if !w.client.holderIndexEnabled {
		return nil
	}
	if w.holderIndexFailure != nil {
		return w.holderIndexFailure
	}
	return w.client.PromoteHolderIndex(ctx, w.identity, w.holderIndexStagedRows)
}

func (w *BatchWriter) TotalRows() uint64 {
	return w.totalRows
}

func (w *BatchWriter) VirtualLedgerTransactions() bool {
	return w.client.virtualLedgerTransactions
}

func (w *BatchWriter) ExpectedRows() map[string]uint64 {
	result := make(map[string]uint64, len(schema.Datasets()))
	for _, dataset := range schema.Datasets() {
		if table := w.tables[dataset.Name]; table != nil {
			result[dataset.Name] = table.nextRow
		} else {
			result[dataset.Name] = 0
		}
	}
	return result
}

func (w *BatchWriter) PopulatedDatasets() []string {
	result := make([]string, 0, len(w.tables))
	for name, table := range w.tables {
		if table.nextRow > 0 {
			result = append(result, name)
		}
	}
	sort.Strings(result)
	return result
}

func (w *BatchWriter) flushTable(
	ctx context.Context,
	dataset string,
	table *tableBuffer,
) error {
	if w.pendingInsertError != nil {
		if table.nativeBuffer != nil {
			w.failTypedNative(table, w.pendingInsertError)
		}
		return w.pendingInsertError
	}
	if table.bufferRows == 0 {
		return nil
	}
	token := w.identity.ID + ":" + dataset + ":" + strconv.FormatUint(table.chunk, 10)
	if w.limits.RecoveryNamespace != "" {
		token += ":recovery:" + w.limits.RecoveryNamespace
	}
	if table.nativeBuffer != nil {
		if err := table.nativeBuffer.finishBlock(); err != nil {
			return w.failTypedNative(table, err)
		}
	}
	if w.limits.MaximumPendingInserts > 0 {
		err := w.scheduleInsert(ctx, dataset, token, table)
		if err != nil && table.nativeBuffer != nil {
			return w.failTypedNative(table, err)
		}
		return err
	}
	started := time.Now()
	var err error
	if table.nativeBuffer != nil {
		job := &pendingInsert{native: detachTypedNative(table)}
		job.timings.nativeEncode = job.native.preEncode
		w.runInsert(ctx, dataset, token, nil, job)
		err = job.err
		w.insertTimings.add(job.timings)
		w.rememberInsertError(err)
	} else {
		err = w.client.insert(ctx, dataset, token, table.body.Bytes(), &w.insertTimings)
	}
	w.flushElapsed += time.Since(started)
	if err != nil {
		return err
	}
	w.flushedRows += uint64(table.bufferRows)
	w.flushedChunks++
	w.flushedJSONBytes += uint64(table.body.Len())
	if typedNativeEnabled(w.limits, dataset) {
		table.body = bytes.Buffer{}
	} else {
		table.body.Reset()
	}
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
