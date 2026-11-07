package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

func priceTestParity(t *testing.T, value any) {
	t.Helper()
	want, err := legacyPreparedDynamic(value)
	if err != nil {
		t.Fatal(err)
	}
	for _, prepare := range []func(any) (any, error){prepareRetainedTypedDynamic, prepareTypedDynamic} {
		got, err := prepare(value)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatal("Price Dynamic semantics differ", err)
		}
	}
}

func TestTypedPricePinnedShapeAndValues(t *testing.T) {
	typeOf := reflect.TypeOf(transform.Price{})
	if typeOf.NumField() != 2 || typeOf.Field(0).Name != "Numerator" || typeOf.Field(1).Name != "Denominator" || typeOf.Field(0).Type != reflect.TypeOf(int32(0)) || typeOf.Field(1).Type != reflect.TypeOf(int32(0)) || typeOf.Field(0).Tag.Get("json") != "n" || typeOf.Field(1).Tag.Get("json") != "d" {
		t.Fatal("pinned Price shape changed")
	}
	if typeOf.Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) {
		t.Fatal("Price gained custom JSON semantics")
	}
	for _, p := range []transform.Price{{}, {Numerator: -1, Denominator: 3}, {Numerator: math.MinInt32, Denominator: math.MaxInt32}, {Numerator: math.MaxInt32, Denominator: math.MinInt32}, {Numerator: 1, Denominator: 7}} {
		for _, value := range []any{p, map[string]any{"price": p, "large": int64(9007199254740993), "max": uint64(math.MaxUint64), "decimal": "12345678901234567890.0000001"}, []any{p, int64(9007199254740993), uint64(math.MaxUint64), "0.0000001"}} {
			priceTestParity(t, value)
		}
	}
}

func TestTypedPriceDepthAndUnsupportedBoundaries(t *testing.T) {
	p := transform.Price{Numerator: 1, Denominator: 3}
	for _, depth := range []int{126, 127, 128} {
		var value any = p
		for i := 0; i < depth; i++ {
			value = []any{value}
		}
		_, directErr := directTypedDynamic(value, 0)
		_, legacyErr := legacyPreparedDynamic(value)
		_, retainedErr := prepareRetainedTypedDynamic(value)
		_, generalErr := prepareTypedDynamic(value)
		if depth <= 127 {
			if directErr != nil || legacyErr != nil || retainedErr != nil || generalErr != nil {
				t.Fatal("valid combined depth rejected", depth)
			}
			priceTestParity(t, value)
		} else if directErr == nil || legacyErr == nil || retainedErr == nil || generalErr == nil {
			t.Fatal("invalid combined depth accepted")
		}
	}
	type namedPrice transform.Price
	for _, value := range []any{namedPrice(p), &p} {
		if _, err := prepareRetainedTypedDynamic(value); !errors.Is(err, errTypedNativeUnsupported) {
			t.Fatal("nonexact Price shape accepted", err)
		}
		want, we := legacyPreparedDynamic(value)
		got, ge := prepareTypedDynamic(value)
		if we != nil || ge != nil || !reflect.DeepEqual(want, got) {
			t.Fatal("unsupported shape lost legacy fallback")
		}
	}
	for _, value := range []any{map[string]any{"price": p, "bad": math.NaN()}, map[string]any{"price": p, "bad": json.Number("invalid")}} {
		if _, err := prepareRetainedTypedDynamic(value); err == nil {
			t.Fatal("invalid sibling accepted directly")
		}
		_, want := legacyPreparedDynamic(value)
		_, got := prepareTypedDynamic(value)
		if want == nil || got == nil || reflect.TypeOf(want) != reflect.TypeOf(got) || want.Error() != got.Error() {
			t.Fatal("legacy invalid sibling error changed")
		}
	}
}

func TestTypedPriceOwnershipAndWriterParity(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			var captures [2]effectsTestCapture
			for mode := range captures {
				w := operationTestWriter(t, mode == 1, pending, 2, &captures[mode])
				var bytesOffered uint64
				for i := 0; i < 3; i++ {
					row := operationTestRow(i)
					row.OperationDetailsJSON = map[string]any{"price_r": transform.Price{Numerator: int32(i) - 1, Denominator: 7}, "large": uint64(math.MaxUint64)}
					body, err := w.PrepareRow("history_operations", row)
					if err != nil {
						t.Fatal(err)
					}
					before := bytes.Clone(body)
					p, err := w.PrepareNativeRow("history_operations", row)
					if err != nil || (mode == 1 && p == nil) {
						t.Fatal("Price row not prepared", err)
					}
					var enriched bytes.Buffer
					if _, err := appendPreparedRow(&enriched, body, w.identity, 1, uint64(i), w.ingestedAt); err != nil {
						t.Fatal(err)
					}
					bytesOffered += uint64(enriched.Len())
					if mode == 1 {
						row.OperationDetailsJSON["price_r"] = transform.Price{Numerator: 999, Denominator: 1}
						row.OperationDetailsJSON["large"] = "changed"
					}
					if err := w.EmitPreparedNative(context.Background(), "history_operations", 1, body, p); err != nil {
						t.Fatal(err)
					}
					if !bytes.Equal(body, before) {
						t.Fatal("retained JSON mutated")
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				stats := w.DatasetWriteStats()
				if stats.Rows != 3 || stats.Chunks != 2 || stats.JSONBytes != bytesOffered {
					t.Fatal("ACK/chunk/JSON accounting changed")
				}
			}
			effectsTestCompare(t, captures[0].calls, captures[1].calls, false)
			for mode := range captures {
				var capture effectsTestCapture
				w := operationTestWriter(t, mode == 1, pending, 2, &capture)
				custom := &typedFallbackStatefulMarshaler{failAfterFirst: true}
				row := operationTestRow(0)
				row.OperationDetailsJSON = map[string]any{"price_r": transform.Price{Numerator: 1, Denominator: 3}, "custom": custom}
				body, err := w.PrepareRow("history_operations", row)
				if err != nil {
					t.Fatal(err)
				}
				p, err := w.PrepareNativeRow("history_operations", row)
				if err != nil || p != nil || custom.calls != 1 {
					t.Fatal("custom sibling did not decline without remarshalling", err)
				}
				if err := w.EmitPreparedNative(context.Background(), "history_operations", 1, body, p); err != nil {
					t.Fatal(err)
				}
				if err := w.Flush(context.Background()); err != nil || custom.calls != 1 || w.DatasetWriteStats().Rows != 1 {
					t.Fatal("retained fallback changed", err)
				}
			}
		})
	}
}

type priceTestCollector struct{ rows []transform.OperationOutput }

func (*priceTestCollector) VirtualLedgerTransactions() bool { return true }

func (c *priceTestCollector) Emit(_ context.Context, dataset string, _ uint32, row any) error {
	if dataset == "history_operations" {
		operation, ok := row.(transform.OperationOutput)
		if !ok {
			return fmt.Errorf("unexpected operation row type")
		}
		if _, ok := operation.OperationDetailsJSON["price_r"].(transform.Price); ok {
			c.rows = append(c.rows, operation)
		}
	}
	return nil
}

func TestTypedPriceRetainedLedgerOperations(t *testing.T) {
	const sequence = 53312000
	batch, err := lcmbatch.DecodeFile(filepath.Join("..", "..", "..", "full-history-etl", "internal", "testdata", "FCD285FF--53312000.xdr.zstd"), sequence, sequence, lcmbatch.Limits{MaxCompressedBytes: 1 << 20, MaxUncompressedBytes: 64 << 20, MaxDecodedMemoryBytes: 64 << 20, MaxLedgers: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Close()
	if batch.CompressedSHA256 != "5c6e4746eb4e7a6e1fdca74e64639bbb5981f8caf8634c5a33bd007c942b178d" || batch.CompressedBytes != 72651 || batch.UncompressedBytes != 372492 || batch.LedgerCount != 1 {
		t.Fatal("retained fixture identity changed")
	}
	collector := &priceTestCollector{}
	p, err := projector.New("Public Global Stellar Network ; September 2015", collector)
	if err != nil {
		t.Fatal(err)
	}
	if err := batch.ForEach(64<<20, func(meta xdr.LedgerCloseMeta) error { return p.ProcessLedger(context.Background(), meta) }); err != nil {
		t.Fatal(err)
	}
	if len(collector.rows) != 100 {
		t.Fatal("retained Price operation count changed")
	}
	buy, sell := 0, 0
	for _, row := range collector.rows {
		switch row.Type {
		case int32(xdr.OperationTypeManageBuyOffer):
			buy++
		case int32(xdr.OperationTypeManageSellOffer):
			sell++
		default:
			t.Fatal("unexpected Price operation type")
		}
	}
	if buy != 53 || sell != 47 {
		t.Fatal("retained Price operation mix changed")
	}
	for _, pending := range []int{0, 2} {
		var captures [2]effectsTestCapture
		for mode := range captures {
			w := operationTestWriter(t, mode == 1, pending, 17, &captures[mode])
			preparedCount := 0
			for _, row := range collector.rows {
				original, err := json.Marshal(row)
				if err != nil {
					t.Fatal(err)
				}
				body, err := w.PrepareRow("history_operations", row)
				if err != nil {
					t.Fatal(err)
				}
				prepared, err := w.PrepareNativeRow("history_operations", row)
				if err != nil {
					t.Fatal(err)
				}
				if prepared != nil {
					preparedCount++
				}
				if err := w.EmitPreparedNative(context.Background(), "history_operations", sequence, body, prepared); err != nil {
					t.Fatal(err)
				}
				after, err := json.Marshal(row)
				if err != nil || !bytes.Equal(original, after) {
					t.Fatal("projected row JSON changed")
				}
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if mode == 1 && preparedCount != 100 {
				t.Fatal("not all retained Price rows prepared")
			}
			if stats := w.DatasetWriteStats(); stats.Rows != 100 || stats.Chunks != 6 {
				t.Fatal("retained ACK/chunks changed")
			}
		}
		effectsTestCompare(t, captures[0].calls, captures[1].calls, false)
	}
}
