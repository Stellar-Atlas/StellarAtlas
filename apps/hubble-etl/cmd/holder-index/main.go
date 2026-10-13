package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "holder-index:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: holder-index seed ASSET | seed-pools | backfill | promote")
	}
	db := os.Getenv("CLICKHOUSE_DATABASE")
	if db == "" {
		db = "stellar_hubble_v2"
	}
	policy := os.Getenv("CLICKHOUSE_HOLDER_INDEX_STORAGE_POLICY")
	if policy == "" {
		policy = "stellar_read_models"
	}
	client, err := clickhouse.New(clickhouse.Config{Endpoint: os.Getenv("CLICKHOUSE_URL"), User: os.Getenv("CLICKHOUSE_USER"), Password: os.Getenv("CLICKHOUSE_PASSWORD"), Database: db, HTTPClient: &http.Client{Timeout: 12 * time.Minute}, HolderIndexEnabled: true, HolderIndexStoragePolicy: policy})
	if err != nil {
		return err
	}
	if err = client.InitializeHolderIndex(ctx); err != nil {
		return err
	}
	index := indexer{client: client, database: db, policy: policy}
	if err = index.initialize(ctx); err != nil {
		return err
	}
	switch os.Args[1] {
	case "initialize":
		return nil
	case "recover":
		return index.recover(ctx)
	case "seed":
		if len(os.Args) != 3 {
			return fmt.Errorf("seed requires one exact asset")
		}
		return index.seed(ctx, os.Args[2])
	case "seed-pools":
		return index.seedPools(ctx)
	case "backfill":
		if err = index.backfill(ctx); err != nil {
			return err
		}
		fallthrough
	case "promote":
		for ctx.Err() == nil {
			if err = index.promote(ctx); err != nil {
				logEvent("promotion-pending", err.Error())
			}
			if err = index.recover(ctx); err != nil {
				logEvent("recovery-pending", err.Error())
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(30 * time.Second):
			}
		}
	default:
		return fmt.Errorf("unknown index command")
	}
	return nil
}

func logEvent(event string, value any) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"event": event, "detail": value, "at": time.Now().UTC().Format(time.RFC3339)})
}

func validName(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz0123456789_", c) {
			return false
		}
	}
	return true
}
