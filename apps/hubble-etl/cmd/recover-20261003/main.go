// This incident command is intentionally allowlisted and single-batch. It does
// not initialize schema, schedule work, restart services, or erase dedup history.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/jackc/pgx/v5"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/backfill"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/ingestion"
)

const network = "Public Global Stellar Network ; September 2015"
const namespace = "incident-20261003-v1"

var allowed = map[string]clickhouse.BatchIdentity{
	"29cf59e5-0665-4875-b37d-4b7b05bd85f2": {ID: "29cf59e5-0665-4875-b37d-4b7b05bd85f2", SourceSHA256: "cc3d38f55283842f7e28a567adc04eff4aba4c2ea9a6fd0ed2b8ce474c42c3a7", StartLedger: 36727939, EndLedger: 36728962},
	"fe3a40ee-11ff-4040-91d5-e8b5ec3b284c": {ID: "fe3a40ee-11ff-4040-91d5-e8b5ec3b284c", SourceSHA256: "1cf57a915ff05f92527bcef742c17c91922d0a82ec50d3aab9b67c08332c001b", StartLedger: 36728963, EndLedger: 36729986},
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 4 || (os.Args[1] != "check" && os.Args[1] != "run") {
		return fmt.Errorf("usage: recover-20261003 check|run ALLOWLISTED_BATCH_ID ABSOLUTE_STORAGE_ROOT")
	}
	id, ok := allowed[os.Args[2]]
	if !ok {
		return fmt.Errorf("batch is not incident-allowlisted")
	}
	root := os.Args[3]
	if !filepath.IsAbs(root) {
		return fmt.Errorf("storage root must be absolute")
	}
	if os.Getenv("CLICKHOUSE_DATABASE") != "stellar_hubble_v2" {
		return fmt.Errorf("recovery requires stellar_hubble_v2 database")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("ACTIVE_DATABASE_URL"))
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	networkHash := sha256.Sum256([]byte(network))
	var key, digest string
	var first, last, count uint32
	err = conn.QueryRow(ctx, `SELECT d.storage_key,encode(d.output_sha256,'hex'),b.start_ledger,b.end_ledger,b.ledger_count FROM full_history_ledger_close_meta_batch b JOIN full_history_ledger_close_meta_dataset d ON d.batch_id=b.id AND d.network_passphrase_hash=b.network_passphrase_hash WHERE b.id=$1 AND b.network_passphrase_hash=$2 AND d.dataset='ledger-close-meta'`, id.ID, networkHash[:]).Scan(&key, &digest, &first, &last, &count)
	if err != nil {
		return fmt.Errorf("incident catalog lookup: %w", err)
	}
	if digest != id.SourceSHA256 || first != id.StartLedger || last != id.EndLedger || count != 1024 {
		return fmt.Errorf("catalog does not match incident evidence")
	}
	clean := filepath.Clean(key)
	if filepath.IsAbs(key) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return fmt.Errorf("unsafe source key")
	}
	path := filepath.Join(root, clean)
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	hash := sha256.New()
	_, err = io.Copy(hash, file)
	file.Close()
	if err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != id.SourceSHA256 {
		return fmt.Errorf("raw source SHA mismatch")
	}
	client, err := clickhouse.New(clickhouse.Config{Endpoint: os.Getenv("CLICKHOUSE_URL"), User: os.Getenv("CLICKHOUSE_USER"), Password: os.Getenv("CLICKHOUSE_PASSWORD"), Database: os.Getenv("CLICKHOUSE_DATABASE"), HTTPClient: &http.Client{Timeout: 2 * time.Minute}})
	if err != nil {
		return err
	}
	if err = client.CheckReady(ctx); err != nil {
		return err
	}
	complete, err := client.BatchComplete(ctx, id.ID, id.SourceSHA256)
	if err != nil {
		return err
	}
	if complete {
		return fmt.Errorf("batch already complete; refusing replay")
	}
	if err = client.VerifyBatchRows(ctx, id, nil); err != nil {
		return fmt.Errorf("nonempty batch; review required: %w", err)
	}
	log := func(event, reason string) {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"event": event, "reason": reason, "batchId": id.ID})
	}
	log("recovery-preflight-passed", namespace)
	if os.Args[1] == "check" {
		return nil
	}
	guard := backfill.PressureGuard{MaximumFullBasisPoints: 2000, MaximumSomeBasisPoints: 3000, MaximumInflight: 256, Log: log}
	if err = guard.Wait(ctx); err != nil {
		return err
	}
	log("recovery-started", path)
	receipt, err := ingestion.File(ctx, client, ingestion.Request{Path: path, BatchID: id.ID, SourceSHA256: id.SourceSHA256, ExpectedStart: id.StartLedger, MaximumEnd: id.EndLedger, NetworkPassphrase: network, DecodeLimits: lcmbatch.Limits{MaxCompressedBytes: 8 << 30, MaxUncompressedBytes: 32 << 30, MaxDecodedMemoryBytes: 4 << 30, MaxLedgers: 1024}, WriterLimits: clickhouse.WriterLimits{MaximumRows: 250000, MaximumBytes: 256 << 20, RecoveryNamespace: namespace, RecoveryIngestedAt: time.Date(2026, 10, 3, 23, 54, 0, 0, time.UTC)}})
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(receipt)
}
