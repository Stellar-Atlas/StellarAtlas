package backfill

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestCurrentWriteCapacityRechecksWithoutReplayingAnInsert(t *testing.T) {
	checks, deferrals := 0, 0
	err := waitCurrentWriteCapacity(context.Background(), nil, func(context.Context) error {
		checks++
		if checks == 1 {
			return clickhouse.ErrCurrentBulkHeadroom
		}
		return nil
	}, 0, func(string, string) { deferrals++ })
	if err != nil || checks != 2 || deferrals != 1 {
		t.Fatalf("err=%v checks=%d deferrals=%d", err, checks, deferrals)
	}

	ctx, cancel := context.WithCancel(context.Background())
	checks = 0
	err = waitCurrentWriteCapacity(ctx, nil, func(context.Context) error {
		checks++
		return clickhouse.ErrCurrentBulkHeadroom
	}, time.Hour, func(string, string) { cancel() })
	if !errors.Is(err, context.Canceled) || checks != 1 {
		t.Fatalf("canceled wait admitted another probe: err=%v checks=%d", err, checks)
	}

	drain := make(chan struct{})
	checks = 0
	err = waitCurrentWriteCapacity(context.Background(), drain, func(context.Context) error {
		checks++
		return clickhouse.ErrCurrentBulkHeadroom
	}, time.Hour, func(string, string) { close(drain) })
	if !errors.Is(err, clickhouse.ErrCurrentBulkHeadroom) || checks != 1 {
		t.Fatalf("drain did not end an unsent deferred write: err=%v checks=%d", err, checks)
	}

	drain = make(chan struct{})
	checks = 0
	err = waitCurrentWriteCapacity(context.Background(), drain, func(context.Context) error {
		checks++
		if checks == 1 {
			return clickhouse.ErrCurrentBulkHeadroom
		}
		close(drain)
		return nil
	}, 0, nil)
	if !errors.Is(err, clickhouse.ErrCurrentBulkHeadroom) || checks != 2 {
		t.Fatalf("drain during the recheck admitted an unsent write: err=%v checks=%d", err, checks)
	}
}
