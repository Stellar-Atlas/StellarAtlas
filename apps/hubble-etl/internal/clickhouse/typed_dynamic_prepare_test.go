package clickhouse

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

type dynamicNamedString string
type dynamicNamedMap map[string]any
type dynamicMarshaler struct{}

func (dynamicMarshaler) MarshalJSON() ([]byte, error) { return []byte(`{"custom":1}`), nil }

func TestDirectDynamicLegacyParity(t *testing.T) {
	str := "pointer"
	values := []any{nil, map[string]any(nil), []any(nil), map[string]any{}, []any{}, true, "001<>&", "\u2028", int(-1), int8(-8), int16(-16), int32(-32), int64(math.MinInt64), uint(1), uint8(8), uint16(16), uint32(32), uint64(math.MaxInt64), uint64(math.MaxInt64) + 1, uint64(math.MaxUint64), uintptr(17), float32(1.25), float32(1e-8), float64(1), math.Copysign(0, -1), 1e-7, 1e20, 1e21, json.Number("-0"), json.Number("1e0"), json.Number("18446744073709551615"), json.Number("18446744073709551616"), json.Number("1e999"), json.Number("invalid"), math.NaN(), math.Inf(1), math.Inf(-1), string([]byte{255}), map[string]any{string([]byte{255}): 1}, dynamicNamedString("alias"), dynamicNamedMap{"x": 1}, &str, dynamicMarshaler{}, []byte{1, 2}, []int{1, 2}, map[string]int{"x": 1}, map[string]any{"nested": []any{nil, map[string]any(nil), []any(nil), true, "001", uint64(math.MaxUint64), float32(1.1)}}}
	for i, v := range values {
		want, we := legacyPreparedDynamic(v)
		got, ge := prepareTypedDynamic(v)
		if (we == nil) != (ge == nil) || we != nil && we.Error() != ge.Error() {
			t.Fatalf("case%d error mismatch: legacy=%v candidate=%v", i, we, ge)
		}
		if we == nil && !reflect.DeepEqual(want, got) {
			t.Fatalf("case%d %T differs: %#v != %#v", i, v, want, got)
		}
	}
	for _, depth := range []int{128, 129, 130} {
		var v any = nil
		for i := 0; i < depth; i++ {
			v = []any{v}
		}
		_, we := legacyPreparedDynamic(v)
		_, ge := prepareTypedDynamic(v)
		if (we == nil) != (ge == nil) || we != nil && we.Error() != ge.Error() {
			t.Fatalf("depth%d errors differ: %v %v", depth, we, ge)
		}
	}
	cycle := map[string]any{}
	cycle["self"] = cycle
	_, we := legacyPreparedDynamic(cycle)
	_, ge := prepareTypedDynamic(cycle)
	if we == nil || ge == nil || we.Error() != ge.Error() {
		t.Fatalf("cycle errors differ: %v %v", we, ge)
	}
}

func TestDirectDynamicFallbackAndOwnership(t *testing.T) {
	for _, v := range []any{dynamicNamedString("alias"), &dynamicMarshaler{}, []byte{1}, []int{1}, map[string]int{"x": 1}, map[string]any{"x": dynamicNamedString("alias")}, map[string]any{"x": string([]byte{255})}} {
		if _, err := directTypedDynamic(v, 0); err == nil {
			t.Fatalf("unsupported %T did not select legacy", v)
		}
	}
	input := map[string]any{"nested": []any{"original", map[string]any{"x": 1}}, "null": map[string]any(nil)}
	want, err := legacyPreparedDynamic(input)
	if err != nil {
		t.Fatal(err)
	}
	got, err := prepareTypedDynamic(input)
	if err != nil {
		t.Fatal(err)
	}
	input["nested"].([]any)[0] = "changed"
	input["nested"].([]any)[1].(map[string]any)["x"] = 2
	input["extra"] = 3
	if !reflect.DeepEqual(want, got) {
		t.Fatal("prepared tree retained caller-owned map/slice")
	}
}
