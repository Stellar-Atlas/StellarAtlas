package ingestion

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
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
}

type Receipt struct {
	BatchID      string `json:"batchId"`
	EndLedger    uint32 `json:"endLedger"`
	LedgerCount  uint32 `json:"ledgerCount"`
	RowCount     uint64 `json:"rowCount"`
	Skipped      bool   `json:"skipped"`
	SourceSHA256 string `json:"sourceSha256"`
	StartLedger  uint32 `json:"startLedger"`
}

func File(
	ctx context.Context,
	client *clickhouse.Client,
	request Request,
) (receipt Receipt, finalErr error) {
	if client == nil {
		return receipt, fmt.Errorf("ClickHouse client is required")
	}
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
	identity := clickhouse.BatchIdentity{
		ID:           request.BatchID,
		SourceSHA256: request.SourceSHA256,
		StartLedger:  batch.Start,
		EndLedger:    batch.End,
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

	transformer, err := projector.New(request.NetworkPassphrase, writer)
	if err != nil {
		return receipt, err
	}
	err = batch.ForEach(
		request.DecodeLimits.MaxDecodedMemoryBytes,
		func(meta xdr.LedgerCloseMeta) error {
			return transformer.ProcessLedger(ctx, meta)
		},
	)
	if err != nil {
		return receipt, err
	}
	if err := writer.Flush(ctx); err != nil {
		return receipt, err
	}
	status.Status = "complete"
	status.Error = ""
	status.RowCount = writer.TotalRows()
	status.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := client.RecordBatch(ctx, status); err != nil {
		return receipt, err
	}
	return Receipt{
		BatchID:      request.BatchID,
		SourceSHA256: request.SourceSHA256,
		StartLedger:  batch.Start,
		EndLedger:    batch.End,
		LedgerCount:  uint32(batch.LedgerCount),
		RowCount:     writer.TotalRows(),
	}, nil
}

func truncate(value string, limit int) string {
	value = strings.ToValidUTF8(value, "?")
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
