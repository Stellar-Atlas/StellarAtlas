package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"regexp"
	"strconv"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

const currentWriteBudgetEnv = "HUBBLE_ETL_CURRENT_WRITE_BUDGET_BYTES"
const currentWriteMinimumEnv = "HUBBLE_ETL_CURRENT_WRITE_MIN_LEDGER"
const currentWriteReadyEnv = "HUBBLE_ETL_CURRENT_WRITE_READY_FILE"

var currentReadyPathPattern = regexp.MustCompile("^/run/([A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+$")

func loadCurrentWriteReadyPath(budget uint64) (string, error) {
	value, set := os.LookupEnv(currentWriteReadyEnv)
	if budget == 0 && !set {
		return "", nil
	}
	if budget == 0 || len(value) > 512 || path.Clean(value) != value || !currentReadyPathPattern.MatchString(value) {
		return "", fmt.Errorf("%s must name the guarded publisher readiness file under /run", currentWriteReadyEnv)
	}
	return value, nil
}

func checkCurrentWriterReady(ctx context.Context, cfg config) error {
	if cfg.historyStoragePolicy == nil {
		return fmt.Errorf("bounded publisher requires paired bulk capacity")
	}
	err := cfg.client.CheckCurrentPublicationBulkReserve(ctx, *cfg.historyStoragePolicy)
	if errors.Is(err, clickhouse.ErrCurrentBulkHeadroom) {
		return nil
	}
	return err
}

func loadCurrentWriteBudget(reserved bool, policy *clickhouse.HistoricalStoragePolicy) (uint64, uint32, error) {
	value, set := os.LookupEnv(currentWriteBudgetEnv)
	minimumValue, minimumSet := os.LookupEnv(currentWriteMinimumEnv)
	if !set && !minimumSet {
		return 0, 0, nil
	}
	bytes, err := strconv.ParseUint(value, 10, 64)
	if err != nil || strconv.FormatUint(bytes, 10) != value || bytes < 1<<30 || bytes > 32<<30 {
		return 0, 0, fmt.Errorf("%s must be canonical decimal bytes in 1..32 GiB", currentWriteBudgetEnv)
	}
	minimum, err := strconv.ParseUint(minimumValue, 10, 32)
	if err != nil || minimum == 0 || strconv.FormatUint(minimum, 10) != minimumValue {
		return 0, 0, fmt.Errorf("%s must be an explicit positive ledger number", currentWriteMinimumEnv)
	}
	if !reserved || policy == nil {
		return 0, 0, fmt.Errorf("%s requires continuous reserved-current mode and paired history admission", currentWriteBudgetEnv)
	}
	if err := clickhouse.ValidateCurrentPublicationPolicy(*policy); err != nil {
		return 0, 0, fmt.Errorf("%s: %w", currentWriteBudgetEnv, err)
	}
	return bytes, uint32(minimum), nil
}
