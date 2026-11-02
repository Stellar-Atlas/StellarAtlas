package clickhouse

import (
	"encoding/json"
	"errors"
	"math"
	"unicode/utf8"

	"github.com/ClickHouse/clickhouse-go/v2/lib/chcol"
)

var errDirectDynamicUnsupported = errors.New("Dynamic value requires legacy JSON normalization")

// prepareTypedDynamic owns a detached tagged tree. Unsupported values retry the
// entire field through the unchanged JSON path, including its validation errors.
func prepareTypedDynamic(value any) (any, error) {
	switch v := value.(type) {
	case nil:
		return nil, nil
	case map[string]any:
		if v == nil {
			return nil, nil
		}
	case []any:
		if v == nil {
			return nil, nil
		}
	}
	next, err := directTypedDynamic(value, 0)
	if err == nil {
		return next, nil
	}
	return legacyPreparedDynamic(value)
}

func legacyPreparedDynamic(value any) (any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return nativeInputValue(raw, "Dynamic")
}

func directTypedDynamic(value any, depth int) (chcol.Dynamic, error) {
	if depth > 128 {
		return chcol.Dynamic{}, errDirectDynamicUnsupported
	}
	wrap := chcol.NewDynamicWithType
	signed := func(n int64) (chcol.Dynamic, error) { return wrap(n, "Int64"), nil }
	unsigned := func(n uint64) (chcol.Dynamic, error) {
		if n <= math.MaxInt64 {
			return signed(int64(n))
		}
		return wrap(n, "UInt64"), nil
	}
	switch v := value.(type) {
	case nil:
		return chcol.NewDynamic(nil), nil
	case bool:
		return wrap(v, "Bool"), nil
	case string:
		if !utf8.ValidString(v) {
			return chcol.Dynamic{}, errDirectDynamicUnsupported
		}
		return wrap(v, "String"), nil
	case int:
		return signed(int64(v))
	case int8:
		return signed(int64(v))
	case int16:
		return signed(int64(v))
	case int32:
		return signed(int64(v))
	case int64:
		return signed(v)
	case uint:
		return unsigned(uint64(v))
	case uint8:
		return unsigned(uint64(v))
	case uint16:
		return unsigned(uint64(v))
	case uint32:
		return unsigned(uint64(v))
	case uint64:
		return unsigned(v)
	case uintptr:
		return unsigned(uint64(v))
	case float32, float64, json.Number:
		// Marshal only this scalar: preserve JSON's float formatting, signed
		// zero, number validation, exponent spelling and integer-vs-float tags.
		raw, err := json.Marshal(value)
		if err != nil {
			return chcol.Dynamic{}, err
		}
		normalized, err := nativeInputValue(raw, "Dynamic")
		if err != nil {
			return chcol.Dynamic{}, err
		}
		next, ok := normalized.(chcol.Dynamic)
		if !ok {
			return chcol.Dynamic{}, errDirectDynamicUnsupported
		}
		return next, nil
	case []any:
		if v == nil {
			return chcol.NewDynamic(nil), nil
		}
		out := make([]chcol.Dynamic, len(v))
		for i, item := range v {
			next, err := directTypedDynamic(item, depth+1)
			if err != nil {
				return chcol.Dynamic{}, err
			}
			out[i] = next
		}
		return wrap(out, "Array(Dynamic)"), nil
	case map[string]any:
		if v == nil {
			return chcol.NewDynamic(nil), nil
		}
		out := make(map[string]chcol.Dynamic, len(v))
		for key, item := range v {
			if !utf8.ValidString(key) {
				return chcol.Dynamic{}, errDirectDynamicUnsupported
			}
			next, err := directTypedDynamic(item, depth+1)
			if err != nil {
				return chcol.Dynamic{}, err
			}
			out[key] = next
		}
		return wrap(out, "Map(String, Dynamic)"), nil
	default:
		return chcol.Dynamic{}, errDirectDynamicUnsupported
	}
}
