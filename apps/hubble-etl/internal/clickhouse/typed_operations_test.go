package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stellar/stellar-etl/v2/internal/transform"
)

func operationTestWriter(t testing.TB, enabled bool, pending, maxRows int, transport http.RoundTripper) *BatchWriter {
	t.Helper()
	client, err := New(Config{Endpoint: "http://offline.invalid", Database: "operations_test", SingleCopyOperations: true, HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	w, err := NewBatchWriter(client, BatchIdentity{ID: "6918e5c8-7d82-4f08-a4b6-84a7c338faa8", SourceSHA256: strings.Repeat("a", 64), StartLedger: 1, EndLedger: math.MaxUint32}, WriterLimits{TypedOperations: enabled, MaximumRows: maxRows, MaximumBytes: 256 << 20, MaximumPendingInserts: pending, MaximumPendingInsertBytes: 512 << 20, RecoveryNamespace: "operations-parity", RecoveryIngestedAt: effectsTestAt})
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func operationTestRow(i int) transform.OperationOutput {
	details := map[string]any{"i64": int64(math.MinInt64), "u64": uint64(math.MaxUint64), "decimal": "12345678901234567890.0000001", "unicode": "雪🌌<>&", "vector": []any{nil, true, "001", int64(9007199254740993), json.Number("1.25"), map[string]any{"empty": []any{}}}}
	return transform.OperationOutput{SourceAccount: "G<>&雪", SourceAccountMuxed: "", Type: 1, TypeString: "payment", OperationDetails: map[string]any{"ignored_alias": true}, TransactionID: math.MaxInt64, OperationID: int64(i), ClosedAt: effectsTestAt, OperationResultCode: "op_success", OperationTraceCode: "trace", LedgerSequence: 2, OperationDetailsJSON: details}
}

func TestTypedOperationsSerialPreparedParity(t *testing.T) {
	for _, pending := range []int{0, 2} {
		var captures [2]effectsTestCapture
		var stats [2]DatasetWriteStats
		for mode := range captures {
			w := operationTestWriter(t, mode == 1, pending, 3, &captures[mode])
			for i := 0; i < 13; i++ {
				row := operationTestRow(i)
				if i == 1 {
					row.OperationDetailsJSON = nil
				}
				if i == 2 {
					row.OperationDetailsJSON = map[string]any{}
				}
				if i == 3 {
					row.OperationDetailsJSON = map[string]any{"typed_vector": []uint32{1, 2}, "bytes": []byte{0, 255}}
				}
				if i == 4 {
					row.SourceAccount = string([]byte{255})
				}
				if i == 5 {
					row.ClosedAt = time.Date(2024, 1, 2, 3, 4, 5, 0, time.FixedZone("seconds", 3661))
				}
				var input any = row
				if i == 6 {
					input = &row
				}
				var err error
				if i%3 == 0 {
					err = w.Emit(context.Background(), "history_operations", 2, input)
				} else {
					var body []byte
					body, err = w.PrepareRow("history_operations", input)
					if err == nil {
						var prepared *PreparedNativeRow
						if i%3 == 1 {
							prepared, err = w.PrepareNativeRow("history_operations", input)
						}
						if err == nil {
							err = w.EmitPreparedNative(context.Background(), "history_operations", 2, body, prepared)
						}
					}
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			stats[mode] = w.DatasetWriteStats()
		}
		effectsTestCompare(t, captures[0].calls, captures[1].calls, false)
		if stats[0].Rows != 13 || stats[1].Rows != 13 || stats[0].Chunks != stats[1].Chunks || stats[0].JSONBytes != stats[1].JSONBytes {
			t.Fatal("accounting changed", stats)
		}
	}
}

func TestTypedOperationsExactWireAndImmutable(t *testing.T) {
	var captures [2]effectsTestCapture
	for mode := range captures {
		w := operationTestWriter(t, mode == 1, 0, 100, &captures[mode])
		row := operationTestRow(9007199254740993)
		row.OperationDetailsJSON = map[string]any{"uint": uint64(math.MaxUint64)}
		body, err := w.PrepareRow("history_operations", row)
		if err != nil {
			t.Fatal(err)
		}
		p, err := w.PrepareNativeRow("history_operations", row)
		if err != nil {
			t.Fatal(err)
		}
		if mode == 1 && p == nil {
			t.Fatal("typed operation was not prepared")
		}
		row.OperationDetailsJSON["uint"] = "changed"
		if err := w.EmitPreparedNative(context.Background(), "history_operations", 2, body, p); err != nil {
			t.Fatal(err)
		}
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(captures[0].calls[0].body, captures[1].calls[0].body) || captures[0].calls[0].token != captures[1].calls[0].token {
		t.Fatal("deterministic single-key Native wire/token changed")
	}
}

func TestTypedOperationsDefaultOffAndValidation(t *testing.T) {
	var capture effectsTestCapture
	w := operationTestWriter(t, false, 0, 100, &capture)
	if p, err := w.PrepareNativeRow("history_operations", operationTestRow(1)); p != nil || err != nil {
		t.Fatal("not default off")
	}
	if _, err := NewBatchWriter(&Client{}, w.identity, WriterLimits{TypedOperations: true, MaximumRows: 1, MaximumBytes: 1024}); err == nil {
		t.Fatal("missing single-copy gate")
	}
	for _, enabled := range []bool{false, true} {
		var capture effectsTestCapture
		w := operationTestWriter(t, enabled, 0, 100, &capture)
		row := operationTestRow(1)
		row.OperationDetailsJSON = map[string]any{"bad": math.NaN()}
		if _, err := w.PrepareRow("history_operations", row); err == nil {
			t.Fatal("invalid float accepted")
		}
		row.OperationDetailsJSON = map[string]any{"number": json.Number("18446744073709551616")}
		body, err := w.PrepareRow("history_operations", row)
		if err != nil {
			t.Fatal(err)
		}
		p, prepareErr := w.PrepareNativeRow("history_operations", row)
		if prepareErr == nil {
			prepareErr = w.EmitPreparedNative(context.Background(), "history_operations", 2, body, p)
		}
		if prepareErr == nil {
			prepareErr = w.Flush(context.Background())
		}
		if prepareErr == nil || len(capture.calls) != 0 {
			t.Fatal("overflow integer sent")
		}
	}
}

func TestTypedOperationsMultiBlockWireParity(t *testing.T) {
	var captures [2]effectsTestCapture
	for mode := range captures {
		w := operationTestWriter(t, mode == 1, 0, 100000, &captures[mode])
		for i := 0; i < nativeParallelRows+1; i++ {
			row := transform.OperationOutput{OperationID: int64(i), ClosedAt: effectsTestAt, LedgerSequence: 2}
			if err := w.Emit(context.Background(), "history_operations", 2, row); err != nil {
				t.Fatal(err)
			}
		}
		if err := w.Flush(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(captures[0].calls) != 1 || len(captures[1].calls) != 1 || !bytes.Equal(captures[0].calls[0].body, captures[1].calls[0].body) {
		t.Fatal("multi-block Native wire changed")
	}
	blocks := effectsTestBlocks(t, captures[1].calls[0].body)
	if len(blocks) != 2 || len(blocks[0]) != nativeParallelRows || len(blocks[1]) != 1 {
		t.Fatal("Native row block boundaries changed")
	}
}

type operationStatefulMarshaler struct {
	calls                     int
	failAfterFirst, failFirst bool
}

func (m *operationStatefulMarshaler) MarshalJSON() ([]byte, error) {
	m.calls++
	if m.failFirst || m.failAfterFirst && m.calls > 1 {
		return nil, errors.New("sentinel operation custom marshal failure")
	}
	return []byte(strconv.Itoa(m.calls)), nil
}

func TestTypedOperationsCustomMarshalerUsesRetainedJSONOnce(t *testing.T) {
	for _, prepared := range []bool{false, true} {
		for _, failAfterFirst := range []bool{false, true} {
			var captures [2]effectsTestCapture
			for mode := range captures {
				w := operationTestWriter(t, mode == 1, 0, 100, &captures[mode])
				custom := &operationStatefulMarshaler{failAfterFirst: failAfterFirst}
				row := operationTestRow(1)
				row.OperationDetailsJSON = map[string]any{"custom": custom}
				row.OperationDetails = row.OperationDetailsJSON
				if !prepared {
					if err := w.Emit(context.Background(), "history_operations", 2, row); err != nil {
						t.Fatal(err)
					}
				} else {
					body, err := w.PrepareRow("history_operations", row)
					if err != nil {
						t.Fatal(err)
					}
					p, err := w.PrepareNativeRow("history_operations", row)
					if err != nil || p != nil {
						t.Fatal("custom marshaler must decline typed row", err)
					}
					if err := w.EmitPreparedNative(context.Background(), "history_operations", 2, body, p); err != nil {
						t.Fatal(err)
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				if custom.calls != 1 {
					t.Fatalf("custom marshaler ran %d times", custom.calls)
				}
			}
			if !bytes.Equal(captures[0].calls[0].body, captures[1].calls[0].body) {
				t.Fatal("stateful custom marshal wire differs")
			}
			effectsTestCompare(t, captures[0].calls, captures[1].calls, false)
		}
	}
	for _, prepared := range []bool{false, true} {
		var failures [2]string
		for mode := range failures {
			var capture effectsTestCapture
			w := operationTestWriter(t, mode == 1, 0, 100, &capture)
			custom := &operationStatefulMarshaler{failFirst: true}
			row := operationTestRow(1)
			row.OperationDetailsJSON = map[string]any{"custom": custom}
			row.OperationDetails = row.OperationDetailsJSON
			var err error
			if prepared {
				_, err = w.PrepareRow("history_operations", row)
			} else {
				err = w.Emit(context.Background(), "history_operations", 2, row)
			}
			if err == nil || custom.calls != 1 || len(capture.calls) != 0 {
				t.Fatal("custom marshal error/count/transport changed", err)
			}
			failures[mode] = err.Error()
		}
		if failures[0] != failures[1] {
			t.Fatal("custom marshal error changed", failures)
		}
	}
}

func BenchmarkTypedOperationsIntegrated(b *testing.B) {
	rows := make([]transform.OperationOutput, 1024)
	for i := range rows {
		rows[i] = operationTestRow(i)
	}
	transport := effectsTestTransport(func(r *http.Request) (*http.Response, error) {
		_, err := io.Copy(io.Discard, r.Body)
		if err != nil {
			return nil, err
		}
		return effectsTestResponse(), nil
	})
	for _, typed := range []bool{false, true} {
		name := "generic"
		if typed {
			name = "typed"
		}
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				w := operationTestWriter(b, typed, 0, 32768, transport)
				for _, row := range rows {
					body, err := w.PrepareRow("history_operations", row)
					if err != nil {
						b.Fatal(err)
					}
					p, err := w.PrepareNativeRow("history_operations", row)
					if err != nil {
						b.Fatal(err)
					}
					if err := w.EmitPreparedNative(context.Background(), "history_operations", 2, body, p); err != nil {
						b.Fatal(err)
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
