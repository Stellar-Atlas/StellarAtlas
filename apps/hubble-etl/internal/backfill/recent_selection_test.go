package backfill

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

func TestRecentPriorityFairnessAndCatalogRefresh(t *testing.T) {
	batches := make([]catalog.Batch, 8)
	for i := range batches {
		batches[i] = catalog.Batch{ID: fmt.Sprint(i), StartLedger: uint32(2 + i*1024), EndLedger: uint32(1025 + i*1024), SourceSHA256: fmt.Sprint("sha-", i)}
	}
	completed := make(map[string]string)
	selectIDs := func(want string, incomplete map[string]string) {
		t.Helper()
		selected, count, err := selectPendingBatches(batches, completed, "", 4, 0, 2, incomplete)
		if err != nil || count != len(completed) {
			t.Fatalf("completed=%d err=%v", count, err)
		}
		ids := make([]string, 0, len(selected))
		for _, batch := range selected {
			ids = append(ids, batch.ID)
		}
		if strings.Join(ids, ",") != want {
			t.Fatalf("got %v want %s", ids, want)
		}
	}
	selectIDs("6,7,0,1", nil)
	completed["6"], completed["7"] = "sha-6", "sha-7"
	// Completed recent batches must not promote the next-newest historical pair.
	selectIDs("0,1,2,3", nil)
	batches = append(batches, catalog.Batch{ID: "8", StartLedger: 8194, EndLedger: 9217, SourceSHA256: "sha-8"})
	selectIDs("8,0,1,2", nil)
	// A previous failed/started tail stays unpublished until deliberate recovery.
	selectIDs("0,1,2,3", map[string]string{"8": "sha-8"})
	if batches[0].ID != "0" || batches[7].ID != "7" {
		t.Fatal("catalog mutated")
	}
}

func TestRecentPriorityRetainsSafetyGates(t *testing.T) {
	batches := []catalog.Batch{
		{ID: "old", StartLedger: 2, EndLedger: 1025, SourceSHA256: "a"},
		{ID: "middle", StartLedger: 1026, EndLedger: 2049, SourceSHA256: "b"},
		{ID: "head", StartLedger: 2050, EndLedger: 3073, SourceSHA256: "c"},
	}
	selected, _, err := selectPendingBatches(batches, nil, "middle", 3, 0, 1, nil)
	if err != nil || len(selected) != 3 || selected[0].ID != "middle" || selected[1].ID != "head" || selected[2].ID != "old" {
		t.Fatalf("manual priority: %v %v", selected, err)
	}
	selected, count, err := selectPendingBatches(batches, nil, "", 3, 1026, 1, nil)
	if err != nil || count != 0 || len(selected) != 2 || selected[0].ID != "head" || selected[1].ID != "middle" {
		t.Fatalf("minimum gate: %v %v", selected, err)
	}
	for _, check := range []struct {
		completed, incomplete map[string]string
		priority              string
		minimum               uint32
	}{
		{completed: map[string]string{"head": "changed"}},
		{incomplete: map[string]string{"head": "changed"}},
		{incomplete: map[string]string{"head": "c"}, priority: "head"},
		{minimum: 2051},
	} {
		if _, _, err := selectPendingBatches(batches, check.completed, check.priority, 3, check.minimum, 1, check.incomplete); err == nil {
			t.Fatal("safety gate bypassed", check)
		}
	}
	for _, policy := range [][2]int{{0, 1}, {2, 2}, {-1, 0}, {4, -1}, {100, 65}} {
		if err := ValidateBatchScheduling(policy[0], policy[1]); err == nil {
			t.Fatal("invalid scheduling accepted", policy)
		}
	}
	for _, policy := range [][2]int{{0, 0}, {4, 2}, {1, 0}} {
		if err := ValidateBatchScheduling(policy[0], policy[1]); err != nil {
			t.Fatal(err)
		}
	}
}
