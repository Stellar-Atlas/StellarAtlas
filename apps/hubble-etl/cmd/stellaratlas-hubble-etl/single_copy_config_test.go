package main

import (
	"os"
	"strings"
	"testing"
)

func TestSingleCopyOperationsConfigStrictBoolean(t *testing.T) {
	before := os.Args
	os.Args = []string{"stellaratlas-hubble-etl", "schema"}
	t.Cleanup(func() { os.Args = before })
	t.Setenv("HUBBLE_ETL_RESERVE_CURRENT_WORKER", "false")
	t.Setenv("HUBBLE_ETL_RECENT_BATCHES", "0")
	t.Setenv("HUBBLE_ETL_MAX_BATCHES", "0")
	t.Setenv("CLICKHOUSE_SINGLE_COPY_OPERATIONS", "false")
	t.Setenv("CLICKHOUSE_VIRTUAL_LEDGER_TRANSACTIONS", "false")
	t.Setenv("CLICKHOUSE_STORAGE_LAYOUT_AUTO", "false")
	for _, name := range []string{"CLICKHOUSE_SINGLE_COPY_OPERATIONS", "CLICKHOUSE_VIRTUAL_LEDGER_TRANSACTIONS", "CLICKHOUSE_STORAGE_LAYOUT_AUTO"} {
		for _, value := range []string{"false", "true", "", "not-a-bool", " true "} {
			t.Run(name+"/"+value, func(t *testing.T) {
				t.Setenv(name, value)
				_, err := loadConfig()
				valid := value == "false" || value == "true"
				if (err == nil) != valid || err != nil && !strings.Contains(err.Error(), name) {
					t.Fatalf("value %q valid=%v error=%v", value, valid, err)
				}
			})
		}
	}
}
