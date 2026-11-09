package backfill

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

const currentWindowLedgers uint32 = 4096

type currentWorkerIO struct {
	recent          func(context.Context) ([]catalog.Batch, error)
	agedOut         func(context.Context) (uint32, []catalog.Batch, error)
	history         func(context.Context) ([]catalog.Batch, error)
	states          func(context.Context, []string) (clickhouse.BatchAdmissionSnapshot, error)
	allStates       func(context.Context) (clickhouse.BatchAdmissionSnapshot, error)
	admit           func(context.Context, bool) error
	baselineAdmit   func(context.Context) error
	ingest          func(context.Context, catalog.Batch) (ingestion.Receipt, error)
	ingestCurrent   func(context.Context, catalog.Batch) (ingestion.Receipt, error)
	capacity        func(context.Context) error
	currentCapacity func(context.Context) error
	historyCapacity func(context.Context) error
	wait            func(context.Context) error
	notice          func(bool, string, error)
}

// RunCurrentWorkers reserves exactly one configured slot for current data. The
// historical slots cannot borrow it, and finishing history is never a prerequisite for
// selecting the next current batch. The one-shot Cycle contract is unchanged.
func RunCurrentWorkers(ctx context.Context, config Config, currentGuard *PressureGuard) (Summary, error) {
	if config.WorkerCount < 2 || config.WorkerCount > 4 || config.Client == nil || currentGuard == nil || config.PressureGuard == nil {
		return Summary{}, fmt.Errorf("current worker requires 2..4 workers, a client and both pressure guards")
	}
	if config.PriorityBatchID != "" {
		return Summary{}, fmt.Errorf("explicit batch recovery cannot use continuous current workers")
	}
	var currentCapacity func(context.Context) error
	if config.CurrentWriteBudgetBytes != 0 {
		if config.HistoryStoragePolicy == nil || config.CurrentWriteMinimumLedger == 0 ||
			config.CurrentWriteBudgetBytes < 1<<30 || config.CurrentWriteBudgetBytes > 32<<30 {
			return Summary{}, fmt.Errorf("bounded current publication requires the paired history gate, an explicit minimum ledger and a 1..32 GiB payload budget")
		}
		policy := *config.HistoryStoragePolicy
		if err := clickhouse.ValidateCurrentPublicationPolicy(policy); err != nil {
			return Summary{}, err
		}
		currentCapacity = func(ctx context.Context) error {
			return config.Client.CheckCurrentPublicationBulkReserve(ctx, policy)
		}
	}
	ingest := func(ctx context.Context, batch catalog.Batch, bounded bool) (ingestion.Receipt, error) {
		path, err := sourcePath(config.StorageRoot, batch.StorageKey)
		if err != nil {
			return ingestion.Receipt{}, err
		}
		request := ingestion.Request{
			Path: path, BatchID: batch.ID, SourceSHA256: batch.SourceSHA256,
			ExpectedStart: batch.StartLedger, MaximumEnd: batch.EndLedger,
			NetworkPassphrase: config.NetworkPassphrase, DecodeLimits: config.DecodeLimits,
			WriterLimits: config.WriterLimits, Publisher: config.Publisher,
		}
		if bounded {
			request.DecodeLimits.MaxLedgers = 128
			// A fresh check fences one synchronous INSERT; never let two
			// overlapping requests both see the same unreserved space.
			request.WriterLimits.MaximumPendingInserts = 0
			request.WriterLimits.MaximumPendingInsertBytes = 0
			request.CurrentWriteBudgetBytes = config.CurrentWriteBudgetBytes
			request.CheckCurrentWriteCapacity = func(writeCtx context.Context) error {
				// Only new writes wait; an admitted HTTP request retains existing
				// cancellation/settlement semantics. Never replay the batch here.
				for {
					err := currentCapacity(writeCtx)
					if !errors.Is(err, clickhouse.ErrCurrentBulkHeadroom) {
						return err
					}
					if currentGuard.Log != nil {
						currentGuard.Log("current-write-capacity-deferred", err.Error())
					}
					if err := waitReadiness(writeCtx, 15*time.Second); err != nil {
						return err
					}
				}
			}
		}
		return ingestion.File(ctx, config.Client, request)
	}
	currentConfig := config
	currentConfig.PressureGuard = currentGuard
	currentConfig.HistoryAdmissionHold = nil
	io := currentWorkerIO{
		recent: func(ctx context.Context) ([]catalog.Batch, error) {
			return catalog.LoadRecent(ctx, config.DatabaseURL, config.NetworkPassphrase, 128)
		},
		agedOut: func(ctx context.Context) (uint32, []catalog.Batch, error) {
			return catalog.LoadAgedOut(ctx, config.DatabaseURL, config.NetworkPassphrase, currentWindowLedgers, agedOutMaximumLedgerLag)
		},
		history: func(ctx context.Context) ([]catalog.Batch, error) {
			return catalog.Load(ctx, config.DatabaseURL, config.NetworkPassphrase)
		},
		states: config.Client.BatchAdmissionFor, allStates: config.Client.BatchAdmissionState,
		admit: func(ctx context.Context, current bool) error {
			if current {
				return waitBatchAdmission(ctx, currentConfig)
			}
			return waitBatchAdmission(ctx, config)
		},
		ingest: func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			return ingest(ctx, batch, false)
		},
		capacity: config.Client.CheckBulkReserve,
		wait:     func(ctx context.Context) error { return waitReadiness(ctx, 15*time.Second) },
		notice: func(current bool, event string, err error) {
			guard := config.PressureGuard
			if current {
				guard = currentGuard
			}
			if guard.Log != nil {
				reason := err.Error()
				if len(reason) > 2048 {
					reason = reason[:2048]
				}
				guard.Log(event, reason)
			}
		},
	}
	if currentCapacity != nil {
		io.currentCapacity = currentCapacity
		io.ingestCurrent = func(ctx context.Context, batch catalog.Batch) (ingestion.Receipt, error) {
			return ingest(ctx, batch, true)
		}
	}
	if config.HistoryStoragePolicy != nil {
		policy := *config.HistoryStoragePolicy
		io.historyCapacity = func(ctx context.Context) error {
			return config.Client.CheckHistoricalBulkReserve(ctx, policy, config.WorkerCount-1)
		}
	}
	if config.BaselineHistoryPressureGuard != nil {
		baselineConfig := config
		baselineConfig.PressureGuard = config.BaselineHistoryPressureGuard
		io.baselineAdmit = func(ctx context.Context) error {
			return waitBatchAdmission(ctx, baselineConfig)
		}
	}
	return runCurrentWorkers(ctx, config, io)
}

func runCurrentWorkers(ctx context.Context, config Config, io currentWorkerIO) (Summary, error) {
	admissionCtx, stopAdmission := context.WithCancel(ctx)
	defer stopAdmission()
	if config.Drain != nil {
		go func() {
			select {
			case <-config.Drain:
				stopAdmission()
			case <-admissionCtx.Done():
			}
		}()
	}
	claims := newCurrentClaims()
	results := make(chan result, config.WorkerCount)
	fatal := make(chan error, 1)
	var workers sync.WaitGroup
	historySelector := &laneSelection{claims: claims, minimum: config.MinimumStartLedger}
	for index := 0; index < config.WorkerCount; index++ {
		current := index == 0
		baseline := index == 1 && config.BaselineHistoryPressureGuard != nil
		selector := historySelector
		if current {
			selector = &laneSelection{current: true, claims: claims, minimum: config.MinimumStartLedger}
			if io.ingestCurrent != nil {
				selector.maximum = 128
				selector.minimum = max(selector.minimum, config.CurrentWriteMinimumLedger)
			}
		}
		workers.Add(1)
		go func(current, baseline bool, selector *laneSelection) {
			defer workers.Done()
			hold := config.HistoryAdmissionHold
			if current {
				hold = nil
			}
			for admissionCtx.Err() == nil {
				if err := hold.Wait(admissionCtx); err != nil {
					return
				}
				var admissionErr error
				if baseline && io.baselineAdmit != nil {
					admissionErr = io.baselineAdmit(admissionCtx)
				} else {
					admissionErr = io.admit(admissionCtx, current)
				}
				if admissionErr != nil {
					reportWorkerFailure(admissionCtx, admissionErr, fatal, stopAdmission)
					return
				}
				if hold.blocked() {
					continue
				}
				// No source is selected before a pressure wait. Bound all metadata
				// reads together so an old selection cannot survive a long wait.
				selectionCtx, cancel := context.WithTimeout(admissionCtx, 20*time.Second)
				batch, found, err := selector.next(selectionCtx, io)
				if err == nil {
					err = selectionCtx.Err()
				}
				if err != nil {
					if found {
						selector.release(batch)
					}
					cancel()
					if retryWorkerMetadata(err) && admissionCtx.Err() == nil {
						if io.notice != nil {
							io.notice(current, "catalog-retry", err)
						}
						if io.wait(admissionCtx) != nil {
							return
						}
						continue
					}
					reportWorkerFailure(admissionCtx, err, fatal, stopAdmission)
					return
				}
				if !found {
					cancel()
					if err := io.wait(admissionCtx); err != nil {
						return
					}
					continue
				}
				// Capacity is checked fresh for every admitted batch, independently
				// of the shared cached DESCRIBE/table-readiness probe.
				if config.ReadinessGuard != nil {
					err = config.ReadinessGuard.Wait(selectionCtx)
				}
				capacityDeferred := false
				if err == nil {
					if !current && io.historyCapacity != nil {
						err = io.historyCapacity(selectionCtx)
						capacityDeferred = err != nil
					} else if current && io.currentCapacity != nil {
						err = io.currentCapacity(selectionCtx)
						capacityDeferred = errors.Is(err, clickhouse.ErrCurrentBulkHeadroom)
					} else if io.capacity != nil {
						err = io.capacity(selectionCtx)
					}
				}
				if err == nil {
					err = selectionCtx.Err()
				}
				cancel()
				if err != nil {
					selector.release(batch)
					if admissionCtx.Err() != nil {
						return
					}
					if config.ReadinessGuard != nil && !capacityDeferred {
						config.ReadinessGuard.Invalidate(err)
					}
					if io.notice != nil {
						io.notice(current, "capacity-deferred", err)
					}
					if io.wait(admissionCtx) != nil {
						return
					}
					continue
				}
				if admissionCtx.Err() != nil {
					selector.release(batch)
					return
				}
				if hold.blocked() {
					selector.release(batch)
					continue
				}
				// Only process shutdown cancels admitted imports. A metadata error
				// in the other lane stops new admission and lets this write finish.
				importBatch := io.ingest
				if current && io.ingestCurrent != nil {
					importBatch = io.ingestCurrent
				}
				receipt, importErr := importBatch(ctx, batch)
				if config.ReadinessGuard != nil {
					config.ReadinessGuard.Invalidate(importErr)
				}
				selector.finish(batch)
				if importErr != nil && io.notice != nil {
					io.notice(current, "batch-failed", fmt.Errorf("batch=%s ledgers=%d..%d: %w", batch.ID, batch.StartLedger, batch.EndLedger, importErr))
				}
				results <- result{batch: batch, receipt: receipt, err: importErr}
			}
		}(current, baseline, selector)
	}
	go func() { workers.Wait(); close(results) }()
	var summary Summary
	for item := range results {
		if item.err != nil {
			summary.FailedBatches++
			if len(summary.Failures) < 100 {
				summary.Failures = append(summary.Failures, Failure{
					BatchID: item.batch.ID, StartLedger: item.batch.StartLedger, Error: item.err.Error(),
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
		summary.LastCompletedBatchID = item.batch.ID
		summary.LastCompletedStartLedger = item.batch.StartLedger
		summary.LastCompletedEndLedger = item.batch.EndLedger
		if config.OnProgress != nil {
			config.OnProgress(summary)
		}
	}
	select {
	case err := <-fatal:
		return summary, err
	default:
		return summary, ctx.Err()
	}
}

func retryWorkerMetadata(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || clickhouse.IsWarehouseFailure(err) {
		return true
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		return true
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		code := postgresError.Code
		return len(code) >= 2 && (code[:2] == "08" || code[:2] == "53" || code[:2] == "57" || code == "40001" || code == "40P01" || code == "55P03")
	}
	return false
}

func reportWorkerFailure(ctx context.Context, err error, fatal chan<- error, stop context.CancelFunc) {
	if ctx.Err() == nil {
		select {
		case fatal <- err:
		default:
		}
		stop()
	}
}
