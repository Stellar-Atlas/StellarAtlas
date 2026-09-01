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
)

const publicNetworkPassphrase = "Public Global Stellar Network ; September 2015"

type config struct {
	client            *clickhouse.Client
	databaseURL       string
	maximumBatches    int
	networkPassphrase string
	once              bool
	storageRoot       string
	workers           int
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
	if err := cfg.client.Initialize(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "stellaratlas-hubble-etl:", err)
		return 1
	}
	if os.Args[1] == "schema" {
		fmt.Println(`{"status":"ready"}`)
		return 0
	}
	if err := runBackfill(ctx, cfg); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "stellaratlas-hubble-etl:", err)
		return 1
	}
	return 0
}

func loadConfig() (config, error) {
	var result config
	client, err := clickhouse.New(clickhouse.Config{
		Endpoint:   env("CLICKHOUSE_URL", "http://127.0.0.1:8123"),
		User:       os.Getenv("CLICKHOUSE_USER"),
		Password:   os.Getenv("CLICKHOUSE_PASSWORD"),
		Database:   env("CLICKHOUSE_DATABASE", "stellar_hubble"),
		HTTPClient: &http.Client{Timeout: 10 * time.Minute},
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
	once, err := strconv.ParseBool(env("HUBBLE_ETL_ONCE", "false"))
	if err != nil {
		return result, fmt.Errorf("HUBBLE_ETL_ONCE: %w", err)
	}
	result = config{
		client:            client,
		databaseURL:       os.Getenv("ACTIVE_DATABASE_URL"),
		maximumBatches:    maximumBatches,
		networkPassphrase: env("FULL_HISTORY_NETWORK_PASSPHRASE", publicNetworkPassphrase),
		once:              once,
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
	for {
		summary, err := backfill.Cycle(ctx, backfill.Config{
			Client:            cfg.client,
			DatabaseURL:       cfg.databaseURL,
			MaximumBatches:    cfg.maximumBatches,
			NetworkPassphrase: cfg.networkPassphrase,
			StorageRoot:       cfg.storageRoot,
			WorkerCount:       cfg.workers,
			DecodeLimits: lcmbatch.Limits{
				MaxCompressedBytes:    8 << 30,
				MaxUncompressedBytes:  32 << 30,
				MaxDecodedMemoryBytes: 4 << 30,
				MaxLedgers:            1024,
			},
			WriterLimits: clickhouse.WriterLimits{
				MaximumRows:  25_000,
				MaximumBytes: 32 << 20,
			},
		})
		if err != nil {
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
