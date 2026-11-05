package main

import (
	"os"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

func TestTypedOperationsConfigDefaultAndOptIn(t *testing.T) {
	before := os.Args
	os.Args = []string{"stellaratlas-hubble-etl", "run"}
	t.Cleanup(func() { os.Args = before })
	for key, value := range map[string]string{
		"ACTIVE_DATABASE_URL": "postgres://unused/test", "CLICKHOUSE_URL": "http://offline.invalid",
		"HUBBLE_ETL_WORKERS": "3", "HUBBLE_ETL_RECENT_BATCHES": "2", "HUBBLE_ETL_MAX_BATCHES": "4",
		"HUBBLE_ETL_ONCE": "false", "HUBBLE_ETL_RESERVE_CURRENT_WORKER": "true", "HUBBLE_ETL_ADMISSION_ENABLED": "true",
		"HUBBLE_ETL_PRIORITY_BATCH_ID": "", "CLICKHOUSE_SINGLE_COPY_OPERATIONS": "true",
	} {
		t.Setenv(key, value)
	}
	for _, tc := range []struct {
		value          string
		enabled, valid bool
	}{{"unset", false, true}, {"false", false, true}, {"true", true, true}, {"not-bool", false, false}} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv("HUBBLE_ETL_TYPED_OPERATIONS", tc.value)
			if tc.value == "unset" {
				if err := os.Unsetenv("HUBBLE_ETL_TYPED_OPERATIONS"); err != nil {
					t.Fatal(err)
				}
			}
			cfg, err := loadConfig()
			if !tc.valid {
				if err == nil || !strings.Contains(err.Error(), "HUBBLE_ETL_TYPED_OPERATIONS") {
					t.Fatal("invalid boolean accepted", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			worker := backfillConfig(cfg)
			limits := worker.WriterLimits
			if limits.TypedOperations != tc.enabled || !limits.TypedEffects || !limits.TypedEvents {
				t.Fatal("typed flags changed")
			}
			if limits.MaximumRows != 250000 || limits.MaximumBytes != 256<<20 || limits.MaximumPendingInserts != 2 || limits.MaximumPendingInsertBytes != 512<<20 {
				t.Fatal("writer caps changed")
			}
			if worker.DecodeLimits.MaxCompressedBytes != 8<<30 || worker.DecodeLimits.MaxUncompressedBytes != 32<<30 || worker.DecodeLimits.MaxDecodedMemoryBytes != 4<<30 || worker.DecodeLimits.MaxLedgers != 1024 {
				t.Fatal("decode caps changed")
			}
			if worker.WorkerCount != 3 || !cfg.reserveCurrent || worker.RecentBatches != 2 || worker.MaximumBatches != 4 || worker.PressureGuard == nil || worker.BaselineHistoryPressureGuard == nil || worker.ReadinessGuard == nil || len(schema.Datasets()) != 20 {
				t.Fatal("admission/current/history/dataset configuration changed")
			}
		})
	}
}
