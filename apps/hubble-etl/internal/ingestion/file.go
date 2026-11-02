package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/publication"
)

type Request struct {
	Path              string
	BatchID           string
	SourceSHA256      string
	ExpectedStart     uint32
	MaximumEnd        uint32
	NetworkPassphrase string
	DecodeLimits      lcmbatch.Limits
	WriterLimits      clickhouse.WriterLimits
	Publisher         *publication.WarehousePublisher
}

type Receipt struct {
	BatchID          string            `json:"batchId"`
	EndLedger        uint32            `json:"endLedger"`
	LedgerCount      uint32            `json:"ledgerCount"`
	RowCount         uint64            `json:"rowCount"`
	Skipped          bool              `json:"skipped"`
	SourceSHA256     string            `json:"sourceSha256"`
	StartLedger      uint32            `json:"startLedger"`
	DatasetRows      map[string]uint64 `json:"datasetRows,omitempty"`
	HolderIndexError string            `json:"holderIndexError,omitempty"`
}

func File(
	ctx context.Context,
	client *clickhouse.Client,
	request Request,
) (receipt Receipt, finalErr error) {
	if client == nil {
		return receipt, fmt.Errorf("ClickHouse client is required")
	}
	batchStarted := time.Now()
	stageStarted := batchStarted
	batch, err := lcmbatch.DecodeFile(
		request.Path,
		request.ExpectedStart,
		request.MaximumEnd,
		request.DecodeLimits,
	)
	if err != nil {
		return receipt, err
	}
	defer batch.Close()
	if batch.CompressedSHA256 != request.SourceSHA256 {
		return receipt, fmt.Errorf(
			"immutable source digest %s does not match catalog digest %s",
			batch.CompressedSHA256,
			request.SourceSHA256,
		)
	}
	if batch.LedgerCount > uint64(^uint32(0)) {
		return receipt, fmt.Errorf("immutable batch ledger count is too large")
	}
	decodeValidateElapsed := time.Since(stageStarted)
	identity := clickhouse.BatchIdentity{
		ID:           request.BatchID,
		SourceSHA256: request.SourceSHA256,
		StartLedger:  batch.Start,
		EndLedger:    batch.End,
	}
	if request.WriterLimits.RecoveryNamespace != "" {
		// A recovery is deliberately not an automatic retry: partial/completed
		// recovery data requires operator review, never a blind second replay.
		if err := client.VerifyBatchRows(ctx, identity, nil); err != nil {
			return receipt, fmt.Errorf("recovery requires an empty batch: %w", err)
		}
	}
	writer, err := clickhouse.NewBatchWriter(
		client,
		identity,
		request.WriterLimits,
	)
	if err != nil {
		return receipt, err
	}
	status := clickhouse.BatchStatus{
		BatchID:      request.BatchID,
		SourceSHA256: request.SourceSHA256,
		StartLedger:  batch.Start,
		EndLedger:    batch.End,
		LedgerCount:  uint32(batch.LedgerCount),
		Status:       "started",
		UpdatedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := client.RecordBatch(ctx, status); err != nil {
		return receipt, err
	}
	defer func() {
		if finalErr == nil {
			return
		}
		failureContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		status.Status = "failed"
		status.Error = truncate(finalErr.Error(), 4096)
		status.RowCount = writer.TotalRows()
		status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		_ = client.RecordBatch(failureContext, status)
	}()

	// Join scheduled writes before the earlier failure-recording defer runs.
	defer func() {
		if err := writer.WaitPending(ctx); err != nil && finalErr == nil {
			finalErr = err
		}
	}()

	projectionStats, err := projectBatchOrdered(
		ctx,
		batch,
		request.DecodeLimits.MaxDecodedMemoryBytes,
		request.NetworkPassphrase,
		writer,
	)
	if err != nil {
		return receipt, err
	}
	projectionMode := "ordered-parallel"
	if batch.UncompressedBytes > maxParallelBatchBytes {
		projectionMode = "serial-size-fallback"
	}
	projectionWriteStats := writer.DatasetWriteStats()
	stageStarted = time.Now()
	if err := writer.Flush(ctx); err != nil {
		return receipt, err
	}
	finalFlushElapsed := time.Since(stageStarted)
	stageStarted = time.Now()
	if request.WriterLimits.RecoveryNamespace != "" {
		if err := client.VerifyBatchRows(ctx, identity, writer.ExpectedRows()); err != nil {
			return receipt, fmt.Errorf("stored row verification failed; completion withheld: %w", err)
		}
	} else if writer.VirtualLedgerTransactions() {
		if err := client.VerifyCanonicalTransactionRows(ctx, identity, writer.ExpectedRows()); err != nil {
			return receipt, fmt.Errorf("canonical transaction/header verification failed; completion withheld: %w", err)
		}
	}
	verificationElapsed := time.Since(stageStarted)
	status.Status = "complete"
	status.Error = ""
	status.RowCount = writer.TotalRows()
	// Declared projector outputs, not proof of full target readback validation.
	status.ExpectedDatasetRows = writer.ExpectedRows()
	status.ProjectionContract = "hubble-full20-v1"
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := client.RecordBatch(ctx, status); err != nil {
		return receipt, err
	}
	holderIndexError := ""
	stageStarted = time.Now()
	if err := writer.PromoteHolderIndex(ctx); err != nil {
		holderIndexError = truncate("holder index: "+err.Error(), 512)
		log.Printf("holder index promotion failed batch=%s error=%q", request.BatchID, truncate(err.Error(), 512))
	}
	holderPromotionElapsed := time.Since(stageStarted)
	if request.Publisher != nil {
		request.Publisher.PublishBatch(publication.Event{
			BatchID: request.BatchID, MinLedger: batch.Start, MaxLedger: batch.End,
			PublishedAt: time.Now().UTC().Format(time.RFC3339Nano),
			Datasets:    writer.PopulatedDatasets(),
		})
	}
	var datasetRows map[string]uint64
	if request.WriterLimits.RecoveryNamespace != "" {
		datasetRows = writer.ExpectedRows()
	}
	// One bounded, payload-free record per completed batch. The legacy
	// projectAndInsert field now measures the entire projection stage wall time,
	// including overlapping decode. Worker/sink/flush durations overlap: do not
	// add them together or subtract worker sums from wall. Total is authoritative.
	timingJSON, _ := json.Marshal(struct {
		Event                              string                       `json:"event"`
		BatchID                            string                       `json:"batchId"`
		DecodeValidateMilliseconds         int64                        `json:"decodeValidateMilliseconds"`
		LedgerDecodeMilliseconds           int64                        `json:"ledgerDecodeMilliseconds"`
		ProjectAndInsertMilliseconds       int64                        `json:"projectAndInsertMilliseconds"`
		ProjectionMode                     string                       `json:"projectionMode"`
		ProjectionWorkerMilliseconds       int64                        `json:"overlappingProjectionWorkerMilliseconds"`
		OrderedEmitMilliseconds            int64                        `json:"overlappingOrderedEmitMilliseconds"`
		ProjectionSerialFallbacks          int                          `json:"projectionSerialFallbacks"`
		ProjectionDatasetFlushMilliseconds int64                        `json:"projectionDatasetFlushMilliseconds"`
		FinalFlushMilliseconds             int64                        `json:"finalFlushMilliseconds"`
		VerificationMilliseconds           int64                        `json:"verificationMilliseconds"`
		HolderPromotionMilliseconds        int64                        `json:"holderPromotionMilliseconds"`
		TotalMilliseconds                  int64                        `json:"totalMilliseconds"`
		DatasetWrites                      clickhouse.DatasetWriteStats `json:"datasetWrites"`
	}{
		Event: "batch-stage-timing", BatchID: request.BatchID,
		DecodeValidateMilliseconds:         decodeValidateElapsed.Milliseconds(),
		LedgerDecodeMilliseconds:           projectionStats.LedgerDecodeElapsed.Milliseconds(),
		ProjectAndInsertMilliseconds:       projectionStats.TotalElapsed.Milliseconds(),
		ProjectionMode:                     projectionMode,
		ProjectionWorkerMilliseconds:       projectionStats.ProjectionWorkerElapsed.Milliseconds(),
		OrderedEmitMilliseconds:            projectionStats.OrderedEmitElapsed.Milliseconds(),
		ProjectionSerialFallbacks:          projectionStats.SerialFallbacks,
		ProjectionDatasetFlushMilliseconds: projectionWriteStats.FlushMilliseconds,
		FinalFlushMilliseconds:             finalFlushElapsed.Milliseconds(),
		VerificationMilliseconds:           verificationElapsed.Milliseconds(),
		HolderPromotionMilliseconds:        holderPromotionElapsed.Milliseconds(),
		TotalMilliseconds:                  time.Since(batchStarted).Milliseconds(),
		DatasetWrites:                      writer.DatasetWriteStats(),
	})
	log.Print(string(timingJSON))
	return Receipt{
		BatchID:          request.BatchID,
		SourceSHA256:     request.SourceSHA256,
		StartLedger:      batch.Start,
		EndLedger:        batch.End,
		LedgerCount:      uint32(batch.LedgerCount),
		RowCount:         writer.TotalRows(),
		DatasetRows:      datasetRows,
		HolderIndexError: holderIndexError,
	}, nil
}

func truncate(value string, limit int) string {
	value = strings.ToValidUTF8(value, "?")
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
