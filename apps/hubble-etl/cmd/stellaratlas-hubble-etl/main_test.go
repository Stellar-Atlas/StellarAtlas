package main

import (
	"os"
	"testing"
)

func TestRecentBatchAdmissionConfig(t *testing.T) {
	before := os.Args
	os.Args = []string{"stellaratlas-hubble-etl", "run"}
	t.Cleanup(func() { os.Args = before })
	t.Setenv("ACTIVE_DATABASE_URL", "postgres://unused/test")
	t.Setenv("HUBBLE_ETL_MIN_START_LEDGER", "36803715")
	for _, check := range []struct {
		recent, maximum string
		valid           bool
	}{
		{"0", "0", true}, {"2", "4", true}, {"2", "0", false}, {"2", "2", false}, {"65", "100", false}, {"-1", "4", false},
	} {
		t.Run(check.recent+"/"+check.maximum, func(t *testing.T) {
			t.Setenv("HUBBLE_ETL_RECENT_BATCHES", check.recent)
			t.Setenv("HUBBLE_ETL_MAX_BATCHES", check.maximum)
			cfg, err := loadConfig()
			if (err == nil) != check.valid {
				t.Fatalf("config valid=%v error=%v", check.valid, err)
			}
			if check.valid && cfg.minimumStartLedger != 36803715 {
				t.Fatal("recovery bound lost")
			}
		})
	}
}
