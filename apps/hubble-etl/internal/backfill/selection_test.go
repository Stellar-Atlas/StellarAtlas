package backfill

import (
	"strings"
	"testing"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/catalog"
)

func TestSelectPendingBatches(t *testing.T) {
	batches := []catalog.Batch{
		{ID: "early", StartLedger: 2, SourceSHA256: "sha-early"},
		{ID: "middle", StartLedger: 1026, SourceSHA256: "sha-middle"},
		{ID: "3dca0dce-5e01-4620-a95b-e95ce4a58323", StartLedger: 63490179, SourceSHA256: "sha-modern"},
	}
	for _, test := range []struct {
		name, priority         string
		completed              map[string]string
		maximum, wantCompleted int
		want                   string
	}{
		{name: "normal order", want: "early,middle,3dca0dce-5e01-4620-a95b-e95ce4a58323"},
		{name: "priority preserves remaining order", priority: batches[2].ID, want: "3dca0dce-5e01-4620-a95b-e95ce4a58323,early,middle"},
		{name: "priority precedes admission limit", priority: batches[2].ID, maximum: 1, want: batches[2].ID},
		{name: "completed priority does not replay", priority: batches[2].ID, completed: map[string]string{batches[2].ID: "sha-modern"}, wantCompleted: 1, want: "early,middle"},
		{name: "priority retains digest dedup", priority: strings.ToUpper(batches[2].ID), completed: map[string]string{"early": "sha-early"}, wantCompleted: 1, want: "3dca0dce-5e01-4620-a95b-e95ce4a58323,middle"},
	} {
		t.Run(test.name, func(t *testing.T) {
			pending, completed, err := selectPendingBatches(batches, test.completed, test.priority, test.maximum, 0)
			if err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, len(pending))
			for _, batch := range pending {
				ids = append(ids, batch.ID)
			}
			if strings.Join(ids, ",") != test.want || completed != test.wantCompleted {
				t.Fatalf("pending=%v completed=%d; want %s/%d", ids, completed, test.want, test.wantCompleted)
			}
			if batches[0].ID != "early" || batches[2].StartLedger != 63490179 {
				t.Fatal("input catalog mutated")
			}
		})
	}
}

func TestSelectPendingBatchesRejectsUnknownOrChangedPriority(t *testing.T) {
	batches := []catalog.Batch{{ID: "priority", SourceSHA256: "expected"}}
	if _, _, err := selectPendingBatches(batches, nil, "missing", 0, 0); err == nil || !strings.Contains(err.Error(), "absent") {
		t.Fatalf("unknown priority: %v", err)
	}
	if _, _, err := selectPendingBatches(batches, map[string]string{"priority": "different"}, "priority", 0, 0); err == nil || !strings.Contains(err.Error(), "immutable digest") {
		t.Fatalf("changed priority digest: %v", err)
	}
}

func TestMinimumLedgerDefersWithoutClaimingCompletion(t *testing.T) {
	batches := []catalog.Batch{
		{ID: "old-failed", StartLedger: 2, EndLedger: 1025, SourceSHA256: "failed-sha"},
		{ID: "last-complete", StartLedger: 1026, EndLedger: 2049, SourceSHA256: "complete-sha"},
		{ID: "next", StartLedger: 2050, EndLedger: 3073, SourceSHA256: "next-sha"},
	}
	completed := map[string]string{"last-complete": "complete-sha"}
	pending, count, err := selectPendingBatches(batches, completed, "", 0, 2050)
	if err != nil || len(pending) != 1 || pending[0].ID != "next" || count != 1 || len(completed) != 1 {
		t.Fatalf("pending=%v completed=%d error=%v", pending, count, err)
	}
	if _, _, err = selectPendingBatches(batches, completed, "old-failed", 0, 2050); err == nil {
		t.Fatal("priority bypassed recovery admission bound")
	}
	if _, _, err = selectPendingBatches(batches, completed, "", 0, 2051); err == nil {
		t.Fatal("bound silently skipped a crossing incomplete batch")
	}
	completed["old-failed"] = "changed-sha"
	if _, _, err = selectPendingBatches(batches, completed, "", 0, 2050); err == nil {
		t.Fatal("bound bypassed immutable digest validation")
	}
}
