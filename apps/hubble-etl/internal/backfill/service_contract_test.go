package backfill

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestServiceRetriesWarehouseReadinessWithoutHardBootDependency(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate service contract")
	}
	path := filepath.Join(filepath.Dir(testFile), "../../../../ops/systemd/stellaratlas-hubble-etl.service")
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	settings := make(map[string][]string)
	for _, line := range strings.Split(string(contents), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), "=")
		if found {
			settings[key] = append(settings[key], strings.Fields(value)...)
		}
	}
	has := func(key, value string) bool {
		for _, actual := range settings[key] {
			if actual == value {
				return true
			}
		}
		return false
	}
	if has("Requires", "clickhouse-server.service") {
		t.Fatal("failed ClickHouse boot dependency would prevent ETL readiness retries")
	}
	for key, values := range map[string][]string{
		"After":             {"clickhouse-server.service", "stellaratlas-postgresql.service", "network-online.target"},
		"Wants":             {"clickhouse-server.service", "network-online.target"},
		"RequiresMountsFor": {"/mnt/bulk", "/mnt/fast"},
		"Restart":           {"on-failure"},
		"RestartSec":        {"5s"},
		"Environment": {
			"HUBBLE_ETL_WORKERS=2",
			"HUBBLE_ETL_ADMISSION_ENABLED=true",
			"HUBBLE_ETL_ADMISSION_MAX_IO_FULL_BASIS_POINTS=2000",
			"HUBBLE_ETL_ADMISSION_MAX_IO_SOME_BASIS_POINTS=3000",
			"HUBBLE_ETL_ADMISSION_MAX_MD0_INFLIGHT_REQUESTS=256",
		},
	} {
		for _, value := range values {
			if !has(key, value) {
				t.Errorf("missing required service setting %s=%s", key, value)
			}
		}
	}
}
