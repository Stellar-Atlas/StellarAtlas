package clickhouse

import (
	"context"
	"encoding/json"
	"github.com/guregu/null"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"math"
	"testing"
	"time"
)

func nativeTableFixture() transform.ContractEventOutput {
	return transform.ContractEventOutput{TransactionHash: "hash<>&", TransactionID: math.MinInt64, Successful: true, LedgerSequence: 1, ClosedAt: effectsTestAt, InSuccessfulContractCall: true, ContractId: "001", Type: math.MaxInt32, TypeString: "contract", Topics: []any{"001", true, int64(-2), nil}, TopicsDecoded: []any{json.Number("18446744073709551615"), "false"}, Data: "001", DataDecoded: map[string]any{"uint": uint64(math.MaxUint64), "int": int64(math.MinInt64), "nested": []any{true, 1, "1", nil}}, ContractEventXDR: "AAAA", OperationID: null.IntFrom(math.MaxInt64)}
}
func TestTypedNativeTwoTableMixedParity(t *testing.T) {
	for _, pending := range []int{0, 2} {
		var captures [2]effectsTestCapture
		for mode, enabled := range []bool{false, true} {
			w := nativeTestWriter(t, enabled, enabled, pending, 3, 0, &captures[mode])
			for i := 0; i < 8; i++ {
				for _, dataset := range []string{"history_effects", "history_contract_events"} {
					var row any = transform.EffectOutput{OperationID: int64(i), Details: map[string]any{"string": "001", "int": i}}
					if dataset == "history_contract_events" {
						event := nativeTableFixture()
						event.TransactionID = int64(i)
						if i == 4 {
							event.TransactionHash = string([]byte{255})
						}
						if i == 5 {
							event.ClosedAt = time.Date(2024, 1, 1, 0, 0, 0, 0, time.FixedZone("seconds", 1))
						}
						row = event
					}
					var err error
					if i%3 == 0 {
						err = w.Emit(context.Background(), dataset, 1, row)
					} else {
						var body []byte
						body, err = w.PrepareRow(dataset, row)
						if err == nil {
							if enabled && i%3 == 1 {
								var prepared *PreparedNativeRow
								prepared, err = w.PrepareNativeRow(dataset, row)
								if err == nil {
									err = w.EmitPreparedNative(context.Background(), dataset, 1, body, prepared)
								}
							} else {
								err = w.EmitPrepared(context.Background(), dataset, 1, body)
							}
						}
					}
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if w.TotalRows() != 16 || w.DatasetWriteStats().Rows != 16 || w.DatasetWriteStats().Chunks != 6 {
				t.Fatal("two-table stats differ")
			}
		}
		effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
	}
}
func TestTypedNativeDatasetBindingAndFlags(t *testing.T) {
	for _, flags := range [][2]bool{{false, false}, {true, false}, {false, true}, {true, true}} {
		var capture effectsTestCapture
		w := nativeTestWriter(t, flags[0], flags[1], 2, 250000, 0, &capture)
		effect, err := w.PrepareNativeRow("history_effects", transform.EffectOutput{})
		if err != nil {
			t.Fatal(err)
		}
		event, err := w.PrepareNativeRow("history_contract_events", nativeTableFixture())
		if err != nil {
			t.Fatal(err)
		}
		if (effect != nil) != flags[0] || (event != nil) != flags[1] {
			t.Fatal("separate flags not honored")
		}
	}
	var capture effectsTestCapture
	w := nativeTestWriter(t, true, true, 2, 250000, 0, &capture)
	prepared, err := w.PrepareNativeRow("history_contract_events", nativeTableFixture())
	if err != nil {
		t.Fatal(err)
	}
	body, err := w.PrepareRow("history_effects", transform.EffectOutput{})
	if err != nil {
		t.Fatal(err)
	}
	if err = w.EmitPreparedNative(context.Background(), "history_effects", 1, body, prepared); err == nil {
		t.Fatal("cross-table prepared row accepted")
	}
	if err = w.Flush(context.Background()); err == nil || len(capture.calls) != 0 {
		t.Fatal("cross-table row was sent")
	}
	chunk := &typedNativeChunk{table: "history_contract_events", blocks: [][]byte{{1}}, encodedBytes: 1}
	if err = w.client.insertEncodedNative(context.Background(), "history_effects", "token", chunk, nil); err == nil {
		t.Fatal("cross-table encoded chunk accepted")
	}
	if err = w.client.insertEncodedNative(context.Background(), "history_ledgers", "token", chunk, nil); err == nil {
		t.Fatal("nonwhitelisted table accepted")
	}
}
func TestTypedNativeEventsPreparedImmutabilityAndErrors(t *testing.T) {
	var baseline, typed effectsTestCapture
	for _, enabled := range []bool{false, true} {
		capture := &baseline
		if enabled {
			capture = &typed
		}
		w := nativeTestWriter(t, false, enabled, 2, 250000, 0, capture)
		event := nativeTableFixture()
		body, err := w.PrepareRow("history_contract_events", event)
		if err != nil {
			t.Fatal(err)
		}
		p, err := w.PrepareNativeRow("history_contract_events", event)
		if err != nil {
			t.Fatal(err)
		}
		if enabled && (p == nil || p.RetainedBytes() < len(body)) {
			t.Fatal("missing all-Dynamic retained weight")
		}
		event.Topics[0] = "mutated"
		event.TopicsDecoded[0] = "mutated"
		event.DataDecoded.(map[string]any)["uint"] = "mutated"
		if err = w.EmitPreparedNative(context.Background(), "history_contract_events", 1, body, p); err != nil {
			t.Fatal(err)
		}
		if err = w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	effectsTestCompare(t, baseline.calls, typed.calls, true)
	var capture effectsTestCapture
	w := nativeTestWriter(t, false, true, 2, 250000, 0, &capture)
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		event := nativeTableFixture()
		event.Data = value
		if _, err := w.PrepareNativeRow("history_contract_events", event); err == nil {
			t.Fatal("nonfinite Dynamic accepted")
		}
	}
	if err := w.EmitPrepared(context.Background(), "history_contract_events", 1, []byte(`{"unknown":1}`)); err == nil {
		t.Fatal("unknown event column accepted")
	}
	if err := w.Flush(context.Background()); err == nil || len(capture.calls) != 0 {
		t.Fatal("bad event block sent")
	}
}
