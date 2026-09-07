package projector

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/input"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

const fixtureNetwork = "Public Global Stellar Network ; September 2015"

func transactionFixture(t testing.TB) xdr.LedgerCloseMeta {
	t.Helper()
	batch, err := lcmbatch.DecodeFile(
		filepath.Join("..", "..", "..", "full-history-etl", "internal", "testdata", "FCD285FF--53312000.xdr.zstd"),
		53_312_000, 53_312_000,
		lcmbatch.Limits{MaxCompressedBytes: 1 << 20, MaxUncompressedBytes: 64 << 20, MaxDecodedMemoryBytes: 64 << 20, MaxLedgers: 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Close()
	var result xdr.LedgerCloseMeta
	if err := batch.ForEach(64<<20, func(meta xdr.LedgerCloseMeta) error { result = meta; return nil }); err != nil {
		t.Fatal(err)
	}
	return result
}

type transactionRows map[string][]json.RawMessage

func (r transactionRows) Emit(_ context.Context, dataset string, _ uint32, row any) error {
	encoded, err := json.Marshal(row)
	if err == nil {
		r[dataset] = append(r[dataset], encoded)
	}
	return err
}

func TestSharedTransactionInputsMatchOfficialReadersAndRows(t *testing.T) {
	meta := transactionFixture(t)
	transactions, err := input.TransactionsFromLedger(meta, fixtureNetwork)
	if err != nil {
		t.Fatal(err)
	}
	wantOperations, err := input.OperationsFromLedger(meta, fixtureNetwork)
	if err != nil {
		t.Fatal(err)
	}
	wantTrades, err := input.TradesFromLedger(meta, fixtureNetwork)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(operationsFromTransactions(meta, transactions), wantOperations) {
		t.Fatal("shared operation inputs differ from official reader")
	}
	if !reflect.DeepEqual(tradesFromTransactions(meta, transactions), wantTrades) {
		t.Fatal("shared trade inputs differ from official reader")
	}
	if len(transactions) != 163 || len(wantTrades) == 0 {
		t.Fatalf("fixture does not exercise transactions/trades: %d/%d", len(transactions), len(wantTrades))
	}
	want := transactionRows{}
	for _, item := range wantOperations {
		row, err := transform.TransformOperation(item.Operation, item.OperationIndex, item.Transaction, item.LedgerSeqNum, item.LedgerCloseMeta, fixtureNetwork)
		if err != nil {
			t.Fatal(err)
		}
		if err := want.Emit(context.Background(), "history_operations", meta.LedgerSequence(), row); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range wantTrades {
		rows, err := transform.TransformTrade(item.OperationIndex, item.OperationHistoryID, item.Transaction, item.CloseTime)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if err := want.Emit(context.Background(), "history_trades", meta.LedgerSequence(), row); err != nil {
				t.Fatal(err)
			}
		}
	}
	got := transactionRows{}
	p, err := New(fixtureNetwork, got)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.ProcessLedger(context.Background(), meta); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"history_operations", "history_trades"} {
		if !reflect.DeepEqual(got[table], want[table]) {
			t.Fatalf("%s changed row content or order", table)
		}
	}
	t.Logf("identical official inputs and JSON row order: %d operations, %d trade inputs, %d trades", len(wantOperations), len(wantTrades), len(want["history_trades"]))
}

func BenchmarkTransactionInputReaders(b *testing.B) {
	meta := transactionFixture(b)
	for _, shared := range []bool{false, true} {
		name := "three-readers"
		if shared {
			name = "shared-reader"
		}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				txs, err := input.TransactionsFromLedger(meta, fixtureNetwork)
				if err != nil {
					b.Fatal(err)
				}
				if shared {
					if len(operationsFromTransactions(meta, txs)) == 0 || len(tradesFromTransactions(meta, txs)) == 0 {
						b.Fatal("empty fixture")
					}
				} else {
					if _, err := input.OperationsFromLedger(meta, fixtureNetwork); err != nil {
						b.Fatal(err)
					}
					if _, err := input.TradesFromLedger(meta, fixtureNetwork); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}
