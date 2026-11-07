package clickhouse

import (
	"bytes"
	"context"
	"encoding"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/projector"
)

func offerIDParity(t *testing.T, value any) {
	t.Helper()
	want, err := legacyPreparedDynamic(value)
	if err != nil {
		t.Fatal(err)
	}
	for _, prepare := range []func(any) (any, error){prepareRetainedTypedDynamic, prepareTypedDynamic} {
		got, err := prepare(value)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatal("offer ID Dynamic parity changed", err)
		}
	}
}

func TestTypedOfferIDPinnedTypeAndValues(t *testing.T) {
	typeOf := reflect.TypeOf(xdr.Int64(0))
	if typeOf.Kind() != reflect.Int64 {
		t.Fatal("pinned offer ID kind changed")
	}
	for _, shape := range []reflect.Type{typeOf, reflect.PointerTo(typeOf)} {
		if shape.Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) || shape.Implements(reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()) {
			t.Fatal("offer ID gained custom serialization")
		}
	}
	for _, n := range []int64{0, -1, math.MinInt64, math.MaxInt64, 9007199254740991, 9007199254740993} {
		id := xdr.Int64(n)
		body, err := json.Marshal(id)
		if err != nil || string(body) != strconv.FormatInt(n, 10) {
			t.Fatal("offer ID no longer emits an exact unquoted integer", err)
		}
		for _, value := range []any{id, map[string]any{"offer_id": id, "builtin": n, "string": strconv.FormatInt(n, 10)}, []any{id, n, strconv.FormatInt(n, 10)}} {
			offerIDParity(t, value)
		}
		actual, err := prepareRetainedTypedDynamic(id)
		builtin, be := prepareRetainedTypedDynamic(n)
		if err != nil || be != nil || !reflect.DeepEqual(actual, builtin) {
			t.Fatal("offer ID did not retain builtin signed tagging")
		}
		text, err := prepareRetainedTypedDynamic(strconv.FormatInt(n, 10))
		if err != nil || reflect.DeepEqual(actual, text) {
			t.Fatal("numeric string lost String type")
		}
	}
}

type offerIDNamed int64
type offerIDJSON int64

func (offerIDJSON) MarshalJSON() ([]byte, error) { return []byte(`"custom-json"`), nil }

type offerIDText int64

func (offerIDText) MarshalText() ([]byte, error) { return []byte("custom-text"), nil }

func TestTypedOfferIDDepthAndFallback(t *testing.T) {
	for _, depth := range []int{128, 129} {
		var value any = xdr.Int64(math.MaxInt64)
		for i := 0; i < depth; i++ {
			value = []any{value}
		}
		_, direct := directTypedDynamic(value, 0)
		_, legacy := legacyPreparedDynamic(value)
		_, retained := prepareRetainedTypedDynamic(value)
		_, general := prepareTypedDynamic(value)
		if depth == 128 {
			if direct != nil || legacy != nil || retained != nil || general != nil {
				t.Fatal("valid scalar depth rejected")
			}
			offerIDParity(t, value)
		} else if direct == nil || legacy == nil || retained == nil || general == nil {
			t.Fatal("depth129 accepted")
		}
	}
	id := xdr.Int64(9007199254740993)
	var nilID *xdr.Int64
	for _, value := range []any{nilID, &id, offerIDNamed(1), offerIDJSON(1), offerIDText(1)} {
		if _, err := prepareRetainedTypedDynamic(value); !errors.Is(err, errTypedNativeUnsupported) {
			t.Fatal("nonexact shape accepted", err)
		}
		want, we := legacyPreparedDynamic(value)
		got, ge := prepareTypedDynamic(value)
		if we != nil || ge != nil || !reflect.DeepEqual(want, got) {
			t.Fatal("legacy unsupported fallback changed")
		}
	}
	for _, value := range []any{map[string]any{"offer_id": id, "unknown": make(chan int)}, map[string]any{"offer_id": id, "bad": math.NaN()}} {
		if _, err := prepareRetainedTypedDynamic(value); err == nil {
			t.Fatal("unsupported sibling accepted")
		}
		_, want := legacyPreparedDynamic(value)
		_, got := prepareTypedDynamic(value)
		if want == nil || got == nil || reflect.TypeOf(want) != reflect.TypeOf(got) || want.Error() != got.Error() {
			t.Fatal("legacy sibling error changed")
		}
	}
}

func TestTypedOfferIDWriterParityAndOwnership(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprint(pending), func(t *testing.T) {
			var captures [2]effectsTestCapture
			edges := []int64{0, -1, math.MinInt64, math.MaxInt64, 9007199254740991, 9007199254740993}
			for mode := range captures {
				w := effectsTestWriter(t, mode == 1, pending, 2, 512<<20, &captures[mode])
				var jsonBytes uint64
				for i, n := range edges {
					row := transform.EffectOutput{OperationID: int64(i), Details: map[string]any{"offer_id": xdr.Int64(n), "string": strconv.FormatInt(n, 10)}}
					body, err := w.PrepareRow("history_effects", row)
					if err != nil {
						t.Fatal(err)
					}
					original := bytes.Clone(body)
					p, err := w.PrepareNativeRow("history_effects", row)
					if err != nil || (mode == 1 && p == nil) {
						t.Fatal("offer ID not prepared", err)
					}
					var enriched bytes.Buffer
					if _, err := appendPreparedRow(&enriched, body, w.identity, 1, uint64(i), w.ingestedAt); err != nil {
						t.Fatal(err)
					}
					jsonBytes += uint64(enriched.Len())
					if mode == 1 {
						row.Details["offer_id"] = xdr.Int64(123)
						row.Details["string"] = "mutated"
					}
					if err := w.EmitPreparedNative(context.Background(), "history_effects", 1, body, p); err != nil {
						t.Fatal(err)
					}
					if !bytes.Equal(body, original) {
						t.Fatal("retained JSON changed")
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				if stats := w.DatasetWriteStats(); stats.Rows != 6 || stats.Chunks != 3 || stats.JSONBytes != jsonBytes {
					t.Fatal("effects ACK/chunk/JSON bytes changed")
				}
			}
			effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
			for _, enabled := range []bool{false, true} {
				var capture effectsTestCapture
				w := effectsTestWriter(t, enabled, pending, 2, 512<<20, &capture)
				custom := &typedFallbackStatefulMarshaler{failAfterFirst: true}
				row := transform.EffectOutput{Details: map[string]any{"offer_id": xdr.Int64(7), "custom": custom}}
				body, err := w.PrepareRow("history_effects", row)
				if err != nil {
					t.Fatal(err)
				}
				p, err := w.PrepareNativeRow("history_effects", row)
				if err != nil || p != nil || custom.calls != 1 {
					t.Fatal("stateful sibling did not decline safely", err)
				}
				if err := w.EmitPreparedNative(context.Background(), "history_effects", 1, body, p); err != nil {
					t.Fatal(err)
				}
				if err := w.Flush(context.Background()); err != nil || custom.calls != 1 || w.DatasetWriteStats().Rows != 1 {
					t.Fatal("custom fallback remarshaled", err)
				}
			}
		})
	}
}

type offerIDCollector struct{ rows []transform.EffectOutput }

func (*offerIDCollector) VirtualLedgerTransactions() bool { return true }

func (c *offerIDCollector) Emit(_ context.Context, dataset string, _ uint32, row any) error {
	if dataset == "history_effects" {
		effect, ok := row.(transform.EffectOutput)
		if !ok {
			return fmt.Errorf("unexpected effect row type")
		}
		if _, ok := effect.Details["offer_id"].(xdr.Int64); ok {
			c.rows = append(c.rows, effect)
		}
	}
	return nil
}

func TestTypedOfferIDRetainedLedgerEffects(t *testing.T) {
	const sequence = 53312000
	batch, err := lcmbatch.DecodeFile(filepath.Join("..", "..", "..", "full-history-etl", "internal", "testdata", "FCD285FF--53312000.xdr.zstd"), sequence, sequence, lcmbatch.Limits{MaxCompressedBytes: 1 << 20, MaxUncompressedBytes: 64 << 20, MaxDecodedMemoryBytes: 64 << 20, MaxLedgers: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Close()
	if batch.CompressedSHA256 != "5c6e4746eb4e7a6e1fdca74e64639bbb5981f8caf8634c5a33bd007c942b178d" || batch.CompressedBytes != 72651 || batch.UncompressedBytes != 372492 || batch.LedgerCount != 1 {
		t.Fatal("retained fixture changed")
	}
	collector := &offerIDCollector{}
	p, err := projector.New("Public Global Stellar Network ; September 2015", collector)
	if err != nil {
		t.Fatal(err)
	}
	if err := batch.ForEach(64<<20, func(meta xdr.LedgerCloseMeta) error { return p.ProcessLedger(context.Background(), meta) }); err != nil {
		t.Fatal(err)
	}
	mix := make(map[string]int)
	for _, row := range collector.rows {
		mix[row.TypeString]++
	}
	if len(collector.rows) != 84 || !reflect.DeepEqual(mix, map[string]int{"offer_created": 18, "offer_removed": 22, "offer_updated": 22, "trade": 22}) {
		t.Fatal("retained offer effect mix changed")
	}
	for _, pending := range []int{0, 2} {
		var captures [2]effectsTestCapture
		for mode := range captures {
			w := effectsTestWriter(t, mode == 1, pending, 17, 512<<20, &captures[mode])
			prepared := 0
			for _, row := range collector.rows {
				original, err := json.Marshal(row)
				if err != nil {
					t.Fatal(err)
				}
				body, err := w.PrepareRow("history_effects", row)
				if err != nil {
					t.Fatal(err)
				}
				p, err := w.PrepareNativeRow("history_effects", row)
				if err != nil {
					t.Fatal(err)
				}
				if p != nil {
					prepared++
				}
				if err := w.EmitPreparedNative(context.Background(), "history_effects", sequence, body, p); err != nil {
					t.Fatal(err)
				}
				after, err := json.Marshal(row)
				if err != nil || !bytes.Equal(original, after) {
					t.Fatal("projected JSON changed")
				}
			}
			if err := w.Flush(context.Background()); err != nil {
				t.Fatal(err)
			}
			if mode == 1 && prepared != 84 {
				t.Fatal("retained offer effects not all prepared")
			}
			if stats := w.DatasetWriteStats(); stats.Rows != 84 || stats.Chunks != 5 {
				t.Fatal("retained effects ACK/chunks changed")
			}
		}
		effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
	}
}
