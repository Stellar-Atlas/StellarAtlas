package projector

import (
	"context"
	"strings"
	"testing"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/input"
)

type virtualMarkerEmitter struct {
	counts  countingEmitter
	markers int
	badRows int
}

func (*virtualMarkerEmitter) VirtualLedgerTransactions() bool { return true }

func (e *virtualMarkerEmitter) Emit(ctx context.Context, dataset string, sequence uint32, row any) error {
	if dataset == "ledger_transactions" {
		e.markers++
		if row != nil {
			e.badRows++
		}
	}
	return e.counts.Emit(ctx, dataset, sequence, row)
}

func TestVirtualLedgerProjectorMarkersAndHeaderGuard(t *testing.T) {
	emitter := &virtualMarkerEmitter{counts: countingEmitter{}}
	projector, err := New(fixtureNetwork, emitter)
	if err != nil {
		t.Fatal(err)
	}
	meta := xdr.LedgerCloseMeta{V: 0, V0: &xdr.LedgerCloseMetaV0{}}
	meta.V0.LedgerHeader.Ext.V = 1
	if err := projector.ProcessLedger(context.Background(), meta); err == nil || !strings.Contains(err.Error(), "LedgerHeaderHistoryEntry.Ext.V=0") || len(emitter.counts) != 0 {
		t.Fatalf("unsupported header extension was not rejected before writes: %v", err)
	}
	legacy, err := New(fixtureNetwork, countingEmitter{})
	if err != nil || legacy.virtualLedgerTransactions {
		t.Fatal("emitter without optional capability changed behavior")
	}
	meta = transactionFixture(t)
	transactions, err := input.TransactionsFromLedger(meta, fixtureNetwork)
	if err != nil {
		t.Fatal(err)
	}
	if err := projector.projectTransactions(context.Background(), meta, transactions); err != nil {
		t.Fatal(err)
	}
	if emitter.badRows != 0 || emitter.markers != len(transactions) || emitter.counts["history_transactions"] != len(transactions) {
		t.Fatal("virtual projection did not emit one nil marker per transaction")
	}
}
