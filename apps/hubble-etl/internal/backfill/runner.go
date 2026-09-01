package backfill

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

type Config struct {
	Client            *clickhouse.Client
	DatabaseURL       string
	NetworkPassphrase string
	StorageRoot       string
	WorkerCount       int
	DecodeLimits      lcmbatch.Limits
	WriterLimits      clickhouse.WriterLimits
	MaximumBatches    int
}

type Failure struct {
	BatchID     string `json:"batchId"`
	StartLedger uint32 `json:"startLedger"`
	Error       string `json:"error"`
}

type Summary struct {
	CatalogBatches   int       `json:"catalogBatches"`
	CompletedBatches int       `json:"completedBatches"`
	FailedBatches    int       `json:"failedBatches"`
	IngestedBatches  int       `json:"ingestedBatches"`
	IngestedLedgers  uint64    `json:"ingestedLedgers"`
	IngestedRows     uint64    `json:"ingestedRows"`
	Failures         []Failure `json:"failures,omitempty"`
}

type result struct {
	batch   catalog.Batch
	receipt ingestion.Receipt
	err     error
}

func Cycle(ctx context.Context, config Config) (Summary, error) {
	var summary Summary
	if config.Client == nil {
		return summary, fmt.Errorf("ClickHouse client is required")
	}
	if config.WorkerCount < 1 || config.WorkerCount > 64 {
		return summary, fmt.Errorf("worker count must be between 1 and 64")
	}
	if config.MaximumBatches < 0 {
		return summary, fmt.Errorf("maximum batches cannot be negative")
	}
	batches, err := catalog.Load(
		ctx,
		config.DatabaseURL,
		config.NetworkPassphrase,
	)
	if err != nil {
		return summary, err
	}
	summary.CatalogBatches = len(batches)
	completed, err := config.Client.CompletedBatches(ctx)
	if err != nil {
		return summary, fmt.Errorf("read warehouse completion state: %w", err)
	}
	pending := make([]catalog.Batch, 0, len(batches))
	for _, batch := range batches {
		if digest, ok := completed[batch.ID]; ok {
			if digest != batch.SourceSHA256 {
				return summary, fmt.Errorf(
					"batch %s changed immutable digest from %s to %s",
					batch.ID,
					digest,
					batch.SourceSHA256,
				)
			}
			summary.CompletedBatches++
			continue
		}
		pending = append(pending, batch)
	}
	if config.MaximumBatches > 0 && len(pending) > config.MaximumBatches {
		pending = pending[:config.MaximumBatches]
	}
	if len(pending) == 0 {
		return summary, nil
	}

	jobs := make(chan catalog.Batch)
	results := make(chan result)
	var workers sync.WaitGroup
	for i := 0; i < config.WorkerCount; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for batch := range jobs {
				path, err := sourcePath(config.StorageRoot, batch.StorageKey)
				var receipt ingestion.Receipt
				if err == nil {
					receipt, err = ingestion.File(ctx, config.Client, ingestion.Request{
						Path:              path,
						BatchID:           batch.ID,
						SourceSHA256:      batch.SourceSHA256,
						ExpectedStart:     batch.StartLedger,
						MaximumEnd:        batch.EndLedger,
						NetworkPassphrase: config.NetworkPassphrase,
						DecodeLimits:      config.DecodeLimits,
						WriterLimits:      config.WriterLimits,
					})
				}
				select {
				case results <- result{batch: batch, receipt: receipt, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, batch := range pending {
			select {
			case jobs <- batch:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		workers.Wait()
		close(results)
	}()

	for item := range results {
		if item.err != nil {
			summary.FailedBatches++
			if len(summary.Failures) < 100 {
				summary.Failures = append(summary.Failures, Failure{
					BatchID:     item.batch.ID,
					StartLedger: item.batch.StartLedger,
					Error:       item.err.Error(),
				})
			}
			continue
		}
		if item.receipt.Skipped {
			summary.CompletedBatches++
			continue
		}
		summary.IngestedBatches++
		summary.IngestedLedgers += uint64(item.receipt.LedgerCount)
		summary.IngestedRows += item.receipt.RowCount
	}
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	return summary, nil
}

func sourcePath(root, storageKey string) (string, error) {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if filepath.IsAbs(storageKey) {
		return "", fmt.Errorf("catalog storage key must be relative")
	}
	cleanKey := filepath.Clean(storageKey)
	if cleanKey == "." || cleanKey == ".." ||
		strings.HasPrefix(cleanKey, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("catalog storage key escapes the storage root")
	}
	candidate := filepath.Join(absoluteRoot, cleanKey)
	relative, err := filepath.Rel(absoluteRoot, candidate)
	if err != nil || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("catalog storage key escapes the storage root")
	}
	return candidate, nil
}
