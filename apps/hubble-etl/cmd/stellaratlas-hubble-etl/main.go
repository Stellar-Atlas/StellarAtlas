package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/backfill"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/publication"
)

const publicNetworkPassphrase = "Public Global Stellar Network ; September 2015"

type config struct {
	client               *clickhouse.Client
	databaseURL          string
	maximumBatches       int
	recentBatches        int
	minimumStartLedger   uint32
	priorityBatchID      string
	networkPassphrase    string
	once                 bool
	storageRoot          string
	workers              int
	pressureGuard        *backfill.PressureGuard
	currentGuard         *backfill.PressureGuard
	baselineHistoryGuard *backfill.PressureGuard
	reserveCurrent       bool
	typedOperations      bool
	readinessGuard       *backfill.WarehouseReadinessGuard
	publisher            *publication.WarehousePublisher
}

func main() {
	os.Exit(run())
}

func run() int {
	if len(os.Args) != 2 || (os.Args[1] != "schema" && os.Args[1] != "run") {
		fmt.Fprintln(os.Stderr, "usage: stellaratlas-hubble-etl schema|run")
		return 2
	}
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "stellaratlas-hubble-etl:", err)
		return 2
	}
	ctx, cancel := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer cancel()
	var publisher *publication.WarehousePublisher
	if os.Args[1] == "run" {
		servers := os.Getenv("WAREHOUSE_NATS_URL")
		if servers == "" {
			servers = os.Getenv("NATS_SERVERS")
		}
		if servers == "" {
			servers = "nats://127.0.0.1:4222"
		}
		publisher = publication.NewWarehousePublisher(servers, os.Getenv("NATS_TOKEN"))
		defer publisher.Close()
		cfg.publisher = publisher
	}
	err = cfg.client.Initialize(ctx)
	if err != nil && os.Args[1] == "run" && cfg.readinessGuard.Invalidate(err) {
		if err := cfg.readinessGuard.Wait(ctx); err != nil {
			return 0
		}
		// Retry initialization once after table readiness recovers. A persistent
		// DDL/configuration error with otherwise healthy tables must not spin.
		err = cfg.client.Initialize(ctx)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "stellaratlas-hubble-etl:", err)
		return 1
	}
	if os.Args[1] == "schema" {
		fmt.Println(`{"status":"ready"}`)
		return 0
	}
	if cfg.minimumStartLedger > 0 {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"event": "admission-ledger-bound", "minimumStartLedger": cfg.minimumStartLedger,
			"reason": "Earlier incomplete batches remain unpublished and require separate recovery",
		})
	}
	if err := runBackfill(ctx, cfg); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "stellaratlas-hubble-etl:", err)
		return 1
	}
	return 0
}

func loadConfig() (config, error) {
	var result config
	holderIndexEnabled, err := strconv.ParseBool(
		env("CLICKHOUSE_HOLDER_INDEX_ENABLED", "false"),
	)
	if err != nil {
		return result, fmt.Errorf("CLICKHOUSE_HOLDER_INDEX_ENABLED: %w", err)
	}
	singleCopyValue, set := os.LookupEnv("CLICKHOUSE_SINGLE_COPY_OPERATIONS")
	if !set {
		singleCopyValue = "false"
	}
	singleCopyOperations, err := strconv.ParseBool(singleCopyValue)
	if err != nil {
		return result, fmt.Errorf("CLICKHOUSE_SINGLE_COPY_OPERATIONS: %w", err)
	}
	virtualLedgerValue, set := os.LookupEnv("CLICKHOUSE_VIRTUAL_LEDGER_TRANSACTIONS")
	if !set {
		virtualLedgerValue = "false"
	}
	virtualLedgerTransactions, err := strconv.ParseBool(virtualLedgerValue)
	if err != nil {
		return result, fmt.Errorf("CLICKHOUSE_VIRTUAL_LEDGER_TRANSACTIONS: %w", err)
	}
	autoLayoutValue, set := os.LookupEnv("CLICKHOUSE_STORAGE_LAYOUT_AUTO")
	if !set {
		autoLayoutValue = "false"
	}
	autoStorageLayout, err := strconv.ParseBool(autoLayoutValue)
	if err != nil {
		return result, fmt.Errorf("CLICKHOUSE_STORAGE_LAYOUT_AUTO: %w", err)
	}
	typedOperations, err := strconv.ParseBool(env("HUBBLE_ETL_TYPED_OPERATIONS", "false"))
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_TYPED_OPERATIONS: %w", err)
	}
	client, err := clickhouse.New(clickhouse.Config{
		Endpoint:                  env("CLICKHOUSE_URL", "http://127.0.0.1:8123"),
		User:                      os.Getenv("CLICKHOUSE_USER"),
		Password:                  os.Getenv("CLICKHOUSE_PASSWORD"),
		Database:                  env("CLICKHOUSE_DATABASE", "stellar_hubble"),
		HTTPClient:                &http.Client{Timeout: 10 * time.Minute},
		HolderIndexEnabled:        holderIndexEnabled,
		HolderIndexStoragePolicy:  env("CLICKHOUSE_HOLDER_INDEX_STORAGE_POLICY", "stellar_read_models"),
		SingleCopyOperations:      singleCopyOperations,
		VirtualLedgerTransactions: virtualLedgerTransactions,
		AutoStorageLayout:         autoStorageLayout,
	})
	if err != nil {
		return result, err
	}
	workers, err := positiveInt(env("HUBBLE_ETL_WORKERS", "8"), 64)
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_WORKERS: %w", err)
	}
	maximumBatches, err := nonNegativeInt(
		env("HUBBLE_ETL_MAX_BATCHES", "0"),
	)
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_MAX_BATCHES: %w", err)
	}
	recentBatches, err := nonNegativeInt(env("HUBBLE_ETL_RECENT_BATCHES", "0"))
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_RECENT_BATCHES: %w", err)
	}
	if err := backfill.ValidateBatchScheduling(maximumBatches, recentBatches); err != nil {
		return result, err
	}
	minimumStartLedger, err := strconv.ParseUint(env("HUBBLE_ETL_MIN_START_LEDGER", "0"), 10, 32)
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_MIN_START_LEDGER must be an unsigned 32-bit ledger number")
	}
	once, err := strconv.ParseBool(env("HUBBLE_ETL_ONCE", "false"))
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_ONCE: %w", err)
	}
	guard, err := loadPressureGuard()
	if err != nil {
		return result, err
	}
	reserveCurrent, err := strconv.ParseBool(env("HUBBLE_ETL_RESERVE_CURRENT_WORKER", "false"))
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_RESERVE_CURRENT_WORKER: %w", err)
	}
	reserveCurrent = reserveCurrent && !once
	priorityBatchID := strings.TrimSpace(os.Getenv("HUBBLE_ETL_PRIORITY_BATCH_ID"))
	var currentGuard, baselineHistoryGuard *backfill.PressureGuard
	if reserveCurrent {
		if workers < 2 || workers > 4 || recentBatches == 0 || guard == nil || priorityBatchID != "" {
			return result, fmt.Errorf("reserved current worker requires 2..4 workers, recent priority, enabled admission and no explicit recovery batch")
		}
		currentGuard = &backfill.PressureGuard{
			MaximumFullBasisPoints: 4000, MaximumSomeBasisPoints: 5000,
			MaximumInflight: guard.MaximumInflight, SkipInflightLimit: true,
			Log: func(event, reason string) {
				_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"event": event, "reason": reason, "lane": "current"})
			},
		}
		baselineHistoryGuard = &backfill.PressureGuard{
			MaximumFullBasisPoints: 3000, MaximumSomeBasisPoints: 4000,
			MaximumInflight: guard.MaximumInflight, SkipInflightLimit: true,
			Log: func(event, reason string) {
				_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"event": event, "reason": reason, "lane": "history-baseline"})
			},
		}
	}
	result = config{
		pressureGuard:        guard,
		currentGuard:         currentGuard,
		baselineHistoryGuard: baselineHistoryGuard,
		reserveCurrent:       reserveCurrent,
		typedOperations:      typedOperations,
		readinessGuard: &backfill.WarehouseReadinessGuard{
			Probe: client.CheckReady,
			Log: func(event, reason string) {
				_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"event": event, "reason": reason})
			},
		},
		client:             client,
		databaseURL:        os.Getenv("ACTIVE_DATABASE_URL"),
		maximumBatches:     maximumBatches,
		recentBatches:      recentBatches,
		minimumStartLedger: uint32(minimumStartLedger),
		priorityBatchID:    priorityBatchID,
		networkPassphrase:  env("FULL_HISTORY_NETWORK_PASSPHRASE", publicNetworkPassphrase),
		once:               once,
		storageRoot: env(
			"FULL_HISTORY_DATA_ROOT",
			"/home/observe/stellarbeat-data/full-history/typed",
		),
		workers: workers,
	}
	if os.Args[1] == "run" && result.databaseURL == "" {
		return result, fmt.Errorf("ACTIVE_DATABASE_URL is required")
	}
	return result, nil
}

func runBackfill(ctx context.Context, cfg config) error {
	if cfg.reserveCurrent {
		baselineWorkers, baselineFull, baselineSome := 0, 0, 0
		if cfg.baselineHistoryGuard != nil {
			baselineWorkers, baselineFull, baselineSome = 1, cfg.baselineHistoryGuard.MaximumFullBasisPoints, cfg.baselineHistoryGuard.MaximumSomeBasisPoints
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"event": "reserved-current-worker", "workers": cfg.workers,
			"currentWorkers": 1, "historicalWorkers": cfg.workers - 1,
			"typedEffectsNative":                     true,
			"typedEventsNative":                      true,
			"currentFullPressureBasisPoints":         cfg.currentGuard.MaximumFullBasisPoints,
			"currentSomePressureBasisPoints":         cfg.currentGuard.MaximumSomeBasisPoints,
			"baselineHistoryWorkers":                 baselineWorkers,
			"baselineHistoryFullPressureBasisPoints": baselineFull,
			"baselineHistorySomePressureBasisPoints": baselineSome,
			"maximumInflight":                        cfg.currentGuard.MaximumInflight,
			"bulkReserveBytes":                       uint64(500) << 30,
		})
		// A controlled upgrade can drain admission without cancelling writes.
		// Normal termination still uses the parent process context.
		drainCtx, stopDrain := signal.NotifyContext(ctx, syscall.SIGUSR1)
		defer stopDrain()
		workerConfig := backfillConfig(cfg)
		workerConfig.Drain = drainCtx.Done()
		summary, err := backfill.RunCurrentWorkers(ctx, workerConfig, cfg.currentGuard)
		_ = json.NewEncoder(os.Stdout).Encode(summary)
		return err
	}
	for {
		summary, err := backfill.Cycle(ctx, backfillConfig(cfg))
		if err != nil {
			if cfg.readinessGuard.Invalidate(err) {
				if waitErr := cfg.readinessGuard.Wait(ctx); waitErr != nil {
					return waitErr
				}
				continue
			}
			return err
		}
		if err := json.NewEncoder(os.Stdout).Encode(summary); err != nil {
			return err
		}
		if cfg.once {
			if summary.FailedBatches > 0 {
				return fmt.Errorf("%d immutable batches failed", summary.FailedBatches)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(30 * time.Second):
		}
	}
}

func backfillConfig(cfg config) backfill.Config {
	return backfill.Config{
		Client:                       cfg.client,
		DatabaseURL:                  cfg.databaseURL,
		MaximumBatches:               cfg.maximumBatches,
		RecentBatches:                cfg.recentBatches,
		RefreshStaleSelection:        !cfg.once,
		MinimumStartLedger:           cfg.minimumStartLedger,
		PriorityBatchID:              cfg.priorityBatchID,
		NetworkPassphrase:            cfg.networkPassphrase,
		StorageRoot:                  cfg.storageRoot,
		WorkerCount:                  cfg.workers,
		PressureGuard:                cfg.pressureGuard,
		BaselineHistoryPressureGuard: cfg.baselineHistoryGuard,
		ReadinessGuard:               cfg.readinessGuard,
		Publisher:                    cfg.publisher,
		OnProgress: func(summary backfill.Summary) {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
				"event":           "batch-completed",
				"batchId":         summary.LastCompletedBatchID,
				"startLedger":     summary.LastCompletedStartLedger,
				"endLedger":       summary.LastCompletedEndLedger,
				"ingestedBatches": summary.IngestedBatches,
				"ingestedLedgers": summary.IngestedLedgers,
				"ingestedRows":    summary.IngestedRows,
				"failedBatches":   summary.FailedBatches,
			})
		},
		DecodeLimits: lcmbatch.Limits{
			MaxCompressedBytes:    8 << 30,
			MaxUncompressedBytes:  32 << 30,
			MaxDecodedMemoryBytes: 4 << 30,
			MaxLedgers:            1024,
		},
		WriterLimits: clickhouse.WriterLimits{
			MaximumRows:               250_000,
			MaximumBytes:              256 << 20,
			MaximumPendingInserts:     2,
			MaximumPendingInsertBytes: 512 << 20,
			TypedEffects:              true,
			TypedEvents:               true,
			TypedOperations:           cfg.typedOperations,
		},
	}
}

func loadPressureGuard() (*backfill.PressureGuard, error) {
	enabled, err := strconv.ParseBool(env("HUBBLE_ETL_ADMISSION_ENABLED", "true"))
	if err != nil {
		return nil, fmt.Errorf("HUBBLE_ETL_ADMISSION_ENABLED: %w", err)
	}
	if !enabled {
		return nil, nil
	}
	guard := &backfill.PressureGuard{}
	for _, setting := range []struct {
		name, fallback string
		maximum        int
		target         *int
	}{
		{"HUBBLE_ETL_ADMISSION_MAX_IO_FULL_BASIS_POINTS", "2000", 10000, &guard.MaximumFullBasisPoints},
		{"HUBBLE_ETL_ADMISSION_MAX_IO_SOME_BASIS_POINTS", "3000", 10000, &guard.MaximumSomeBasisPoints},
		{"HUBBLE_ETL_ADMISSION_MAX_MD0_INFLIGHT_REQUESTS", "256", 1000000, &guard.MaximumInflight},
	} {
		value, err := nonNegativeInt(env(setting.name, setting.fallback))
		if err != nil || value > setting.maximum {
			return nil, fmt.Errorf("%s must be between 0 and %d", setting.name, setting.maximum)
		}
		*setting.target = value
	}
	if guard.MaximumFullBasisPoints > guard.MaximumSomeBasisPoints {
		return nil, fmt.Errorf("full I/O threshold cannot exceed some I/O threshold")
	}
	guard.Log = func(event, reason string) {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"event": event, "reason": reason})
	}
	return guard, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func nonNegativeInt(value string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("must be a non-negative integer")
	}
	return parsed, nil
}

func positiveInt(value string, maximum int) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 || parsed > maximum {
		return 0, fmt.Errorf("must be an integer between 1 and %d", maximum)
	}
	return parsed, nil
}
