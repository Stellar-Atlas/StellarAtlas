package main

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

func TestCurrentWriterStartTicksAllowsParenthesesInName(t *testing.T) {
	prefix := "912 (worker ) with ( spaces) R " + strings.Repeat("1 ", 18)
	if got, err := parseCurrentWriterStartTicks(prefix + "123456 9 8\n"); got != "123456" || err != nil {
		t.Fatalf("start ticks = %q, %v", got, err)
	}
	for _, value := range []string{"", "0", "012", "-7", "18446744073709551616"} {
		if _, err := parseCurrentWriterStartTicks(prefix + value); err == nil {
			t.Errorf("accepted invalid ticks %q", value)
		}
	}
}

func TestCurrentWriterReadyRecordIsDeterministicAndNoReplace(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	record := currentWriterReadyRecord{
		Version: 2, BootID: "1aaec73d-62cf-44c9-b8bc-dafc5e740784", InvocationID: "d2580b4946714ef6bb309c29ae18c062",
		PID: 912, StartTicks: "123456", MinimumLedger: 99, MaximumWriteBytes: "34359738368",
		CapacityMode: clickhouse.CurrentRequestCapacityMode,
	}
	if err := writeCurrentWriterReady(root, dir, "ready.json", record); err != nil {
		t.Fatal(err)
	}
	if info, err := root.Stat("ready.json"); err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o644 {
		t.Fatalf("unexpected marker permissions: %v, %v", info, err)
	}
	record.PID++
	if err := writeCurrentWriterReady(root, dir, "ready.json", record); !errors.Is(err, os.ErrExist) {
		t.Fatalf("second writer did not refuse an existing marker: %v", err)
	}
	if err := root.Symlink("absent-target", "symlink.json"); err != nil {
		t.Fatal(err)
	}
	if err := writeCurrentWriterReady(root, dir, "symlink.json", record); !errors.Is(err, os.ErrExist) {
		t.Fatalf("writer did not refuse an existing symlink: %v", err)
	}
	want := `{"version":2,"bootId":"1aaec73d-62cf-44c9-b8bc-dafc5e740784","invocationId":"d2580b4946714ef6bb309c29ae18c062","pid":912,"startTicks":"123456","minimumLedger":99,"maximumWriteBytes":"34359738368","capacityMode":"request-scoped-v1"}` + "\n"
	if got, err := root.ReadFile("ready.json"); err != nil || string(got) != want {
		t.Fatalf("marker = %q, %v", got, err)
	}
	if entries, err := dir.ReadDir(-1); err != nil || len(entries) != 2 {
		t.Fatalf("unexpected directory entries after successful and refused publications: %v, %v", entries, err)
	}
}

func TestCurrentWriterCapabilityRefusesInvalidBudgetOrMinimum(t *testing.T) {
	for _, tc := range []struct {
		minimum uint32
		budget  uint64
	}{{0, 1 << 30}, {1, 0}, {1, (1 << 30) - 1}, {1, (32 << 30) + 1}} {
		if err := publishCurrentWriterReady("unused", tc.minimum, tc.budget); err == nil || !strings.Contains(err.Error(), "1..32 GiB") {
			t.Fatalf("invalid capability was not rejected before host/path checks: %+v, %v", tc, err)
		}
	}
}
