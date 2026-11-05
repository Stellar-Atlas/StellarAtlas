package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/internal/transform"
)

func preparedTestWriter(t *testing.T) *BatchWriter {
	t.Helper()
	writer, err := NewBatchWriter(&Client{
		singleCopyOperations: true, virtualLedgerTransactions: true, holderIndexEnabled: true,
	}, BatchIdentity{
		ID: "6918e5c8-7d82-4f08-a4b6-84a7c338faa8", SourceSHA256: strings.Repeat("a", 64),
		StartLedger: 10, EndLedger: 12,
	}, WriterLimits{
		MaximumRows: 1000, MaximumBytes: 1 << 20, RecoveryNamespace: "prepared-fixture",
		RecoveryIngestedAt: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	return writer
}

func TestPreparedRowsMatchNormalWriter(t *testing.T) {
	normal, prepared := preparedTestWriter(t), preparedTestWriter(t)
	stream := []struct {
		dataset string
		row     any
	}{
		{"history_operations", transform.OperationOutput{}},
		{"history_effects", map[string]any{"details": map[string]any{
			"literal": `{"keep":"string"}`, "number": json.Number("18446744073709551615"),
			"array": []any{nil, true, "2", 2},
		}}},
		{"accounts", map[string]any{"account_id": "Gfixture", "balance": 12.5, "closed_at": "2026-10-30T01:02:03.123456Z"}},
		{"trustlines", map[string]any{"account_id": "Gfixture", "asset_type": "credit_alphanum4",
			"asset_code": "USD", "asset_issuer": "Gissuer", "balance": 2, "closed_at": "2026-10-30T01:02:03Z"}},
		{"liquidity_pools", map[string]any{"liquidity_pool_id": "pool-fixture",
			"liquidity_pool_id_strkey": "Lfixture", "closed_at": "2026-10-30T01:02:03Z"}},
		{"ledger_transactions", nil},
		{"accounts", map[string]any{"account_id": "Gfixture", "balance": 15, "closed_at": "2026-10-30T01:02:03Z"}},
	}
	for _, item := range stream {
		body, err := prepared.PrepareRow(item.dataset, item.row)
		if err != nil {
			t.Fatal(err)
		}
		owned := bytes.Clone(body)
		if err := normal.Emit(context.Background(), item.dataset, 10, item.row); err != nil {
			t.Fatal(err)
		}
		if err := prepared.EmitPrepared(context.Background(), item.dataset, 10, body); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(body, owned) {
			t.Fatal("consumer changed worker-owned prepared bytes")
		}
	}
	if normal.TotalRows() != prepared.TotalRows() || !reflect.DeepEqual(normal.ExpectedRows(), prepared.ExpectedRows()) {
		t.Fatal("logical rows/ordinals changed")
	}
	for name, want := range normal.tables {
		got := prepared.tables[name]
		if got == nil || got.nextRow != want.nextRow || got.chunk != want.chunk ||
			got.bufferRows != want.bufferRows || !bytes.Equal(got.body.Bytes(), want.body.Bytes()) {
			t.Fatalf("buffer/ordinal/chunk differs for %s", name)
		}
	}
	if normal.holderIndexFailure != nil || prepared.holderIndexFailure != nil ||
		!reflect.DeepEqual(normal.holderIndexRows, prepared.holderIndexRows) ||
		!reflect.DeepEqual(normal.poolIndexRows, prepared.poolIndexRows) {
		t.Fatal("holder/pool conversion changed")
	}
	if bytes.Contains(prepared.tables["history_operations"].body.Bytes(), []byte(`"details":`)) {
		t.Fatal("single-copy operation shadow was lost")
	}
	if prepared.tables["ledger_transactions"].body.Len() != 0 || prepared.tables["ledger_transactions"].nextRow != 1 {
		t.Fatal("virtual ledger transaction physical/logical behavior changed")
	}
}

func TestPreparedRowsRetainIdentityAndObjectGuards(t *testing.T) {
	writer := preparedTestWriter(t)
	if _, err := writer.PrepareRow("unknown", struct{}{}); err == nil {
		t.Fatal("unknown dataset was accepted")
	}
	if _, err := writer.PrepareRow("history_effects", nil); err == nil {
		t.Fatal("non-object row was accepted")
	}
	if _, err := writer.PrepareRow("history_operations", map[string]any{}); err == nil {
		t.Fatal("non-official single-copy operation was accepted")
	}
	if err := writer.EmitPrepared(context.Background(), "ledger_transactions", 9, nil); err == nil {
		t.Fatal("virtual row bypassed immutable ledger range")
	}
	if err := writer.EmitPrepared(context.Background(), "history_effects", 10, nil); err == nil {
		t.Fatal("nil non-virtual prepared row was accepted")
	}
	if writer.TotalRows() != 0 {
		t.Fatal("rejected prepared rows changed logical count")
	}
}

func TestPrepareRowUsesOnlyImmutableWriterState(t *testing.T) {
	writer := preparedTestWriter(t)
	row := map[string]any{"details": []any{"literal", true, json.Number("18446744073709551615")}}
	want, err := writer.PrepareRow("history_effects", row)
	if err != nil {
		t.Fatal(err)
	}
	errors := make(chan error, 8)
	var wait sync.WaitGroup
	for range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for range 16 {
				got, err := writer.PrepareRow("history_effects", row)
				if err != nil {
					errors <- err
					return
				}
				if !bytes.Equal(got, want) {
					t.Error("concurrent preparation changed bytes")
					return
				}
			}
		}()
	}
	for range 16 {
		if err := writer.EmitPrepared(context.Background(), "history_effects", 10, want); err != nil {
			t.Fatal(err)
		}
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	if writer.TotalRows() != 16 {
		t.Fatal("preparation mutated central row counts")
	}
}
