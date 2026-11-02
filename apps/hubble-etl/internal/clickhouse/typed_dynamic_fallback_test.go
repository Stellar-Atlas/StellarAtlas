package clickhouse

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"testing"

	"github.com/stellar/stellar-etl/v2/internal/transform"
)

type typedFallbackStatefulMarshaler struct {
	calls          int
	failAfterFirst bool
}

func (m *typedFallbackStatefulMarshaler) MarshalJSON() ([]byte, error) {
	m.calls++
	if m.failAfterFirst && m.calls > 1 {
		return nil, errors.New("sentinel effects/events second custom marshal failure")
	}
	return []byte(strconv.Itoa(m.calls)), nil
}

func typedFallbackFixture(field string, custom *typedFallbackStatefulMarshaler, index int) any {
	if field == "details" {
		return transform.EffectOutput{
			OperationID:    math.MaxInt64 - int64(index),
			LedgerSequence: 1,
			ClosedAt:       effectsTestAt,
			Details:        map[string]any{"custom": custom},
		}
	}
	event := transform.ContractEventOutput{
		TransactionHash: "custom-fallback",
		TransactionID:   math.MinInt64 + int64(index),
		LedgerSequence:  1,
		ClosedAt:        effectsTestAt,
	}
	switch field {
	case "topics":
		event.Topics = []any{custom}
	case "topics_decoded":
		event.TopicsDecoded = []any{custom}
	case "data":
		event.Data = custom
	case "data_decoded":
		event.DataDecoded = map[string]any{"custom": custom}
	default:
		panic("unknown fixed test field")
	}
	return event
}

func TestTypedEffectsEventsCustomMarshalerUsesRetainedJSONOnce(t *testing.T) {
	for _, field := range []string{"details", "topics", "topics_decoded", "data", "data_decoded"} {
		dataset := "history_contract_events"
		if field == "details" {
			dataset = "history_effects"
		}
		for _, prepared := range []bool{false, true} {
			for _, failAfterFirst := range []bool{false, true} {
				name := fmt.Sprintf("%s/prepared=%t/failAfterFirst=%t", field, prepared, failAfterFirst)
				t.Run(name, func(t *testing.T) {
					var captures [2]effectsTestCapture
					for mode := range captures {
						enabled := mode == 1
						w := nativeTestWriter(t, enabled && dataset == "history_effects", enabled && dataset == "history_contract_events", 0, 3, 0, &captures[mode])
						var customs [2]*typedFallbackStatefulMarshaler
						for index := 0; index < 2; index++ {
							custom := &typedFallbackStatefulMarshaler{failAfterFirst: failAfterFirst}
							customs[index] = custom
							row := typedFallbackFixture(field, custom, index)
							if prepared {
								body, err := w.PrepareRow(dataset, row)
								if err != nil {
									t.Fatal(err)
								}
								p, err := w.PrepareNativeRow(dataset, row)
								if err != nil || p != nil {
									t.Fatal("custom marshaler must decline the whole typed row", err)
								}
								if custom.calls != 1 {
									t.Fatalf("preparation marshaled retained data %d times", custom.calls)
								}
								if err := w.EmitPreparedNative(context.Background(), dataset, 1, body, p); err != nil {
									t.Fatal(err)
								}
							} else if err := w.Emit(context.Background(), dataset, 1, row); err != nil {
								t.Fatal(err)
							}
							if custom.calls != 1 {
								t.Fatalf("custom marshaler ran %d times", custom.calls)
							}
						}
						if err := w.Flush(context.Background()); err != nil {
							t.Fatal(err)
						}
						for _, custom := range customs {
							if custom.calls != 1 {
								t.Fatalf("completed insertion marshaled retained data %d times", custom.calls)
							}
						}
						stats := w.DatasetWriteStats()
						if w.TotalRows() != 2 || w.ExpectedRows()[dataset] != 2 || stats.Rows != 2 || stats.Chunks != 1 || len(captures[mode].calls) != 1 {
							t.Fatal("fallback changed logical rows, acknowledged rows or chunk boundaries")
						}
					}
					effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
					if !bytes.Equal(captures[0].calls[0].body, captures[1].calls[0].body) {
						t.Fatal("stateful custom marshal changed exact Native wire bytes")
					}
				})
			}
		}
	}
}
