package clickhouse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/chcol"
)

func nativeInputValue(raw json.RawMessage, kind string) (any, error) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	if strings.HasPrefix(kind, "Nullable(") {
		return nativeInputValue(raw, kind[9:len(kind)-1])
	}
	if kind == "Dynamic" {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		return typedDynamic(value, 0)
	}
	if strings.HasPrefix(kind, "Array(") {
		var input []json.RawMessage
		if err := json.Unmarshal(raw, &input); err != nil {
			return nil, err
		}
		output := make([]any, len(input))
		for i, value := range input {
			decoded, err := nativeInputValue(value, kind[6:len(kind)-1])
			if err != nil {
				return nil, err
			}
			output[i] = decoded
		}
		return output, nil
	}
	if kind == "String" || kind == "UUID" || strings.HasPrefix(kind, "FixedString(") || strings.HasPrefix(kind, "DateTime64(") {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		if strings.HasPrefix(kind, "DateTime64(") {
			return time.Parse(time.RFC3339Nano, value)
		}
		return value, nil
	}
	if kind == "Bool" {
		var value bool
		err := json.Unmarshal(raw, &value)
		return value, err
	}
	if strings.HasPrefix(kind, "UInt") {
		bits, err := strconv.Atoi(kind[4:])
		if err != nil {
			return nil, err
		}
		value, err := strconv.ParseUint(string(raw), 10, bits)
		if err != nil {
			return nil, err
		}
		switch bits {
		case 8:
			return uint8(value), nil
		case 16:
			return uint16(value), nil
		case 32:
			return uint32(value), nil
		case 64:
			return value, nil
		}
	}
	if strings.HasPrefix(kind, "Int") {
		bits, err := strconv.Atoi(kind[3:])
		if err != nil {
			return nil, err
		}
		value, err := strconv.ParseInt(string(raw), 10, bits)
		if err != nil {
			return nil, err
		}
		switch bits {
		case 8:
			return int8(value), nil
		case 16:
			return int16(value), nil
		case 32:
			return int32(value), nil
		case 64:
			return value, nil
		}
	}
	if kind == "Float32" || kind == "Float64" {
		bits := 64
		if kind == "Float32" {
			bits = 32
		}
		value, err := strconv.ParseFloat(string(raw), bits)
		if err != nil {
			return nil, err
		}
		if bits == 32 {
			return float32(value), nil
		}
		return value, nil
	}
	return nil, fmt.Errorf("unsupported Native input type %s", kind)
}

// Always tag every value, including nested scalars. Letting the driver infer
// from an existing variant can otherwise convert numeric strings into numbers.
func typedDynamic(value any, depth int) (chcol.Dynamic, error) {
	if depth > 128 {
		return chcol.Dynamic{}, fmt.Errorf("Dynamic JSON nesting exceeds 128")
	}
	wrap := chcol.NewDynamicWithType
	switch v := value.(type) {
	case nil:
		return chcol.NewDynamic(nil), nil
	case bool:
		return wrap(v, "Bool"), nil
	case string:
		return wrap(v, "String"), nil
	case json.Number:
		if !strings.ContainsAny(string(v), ".eE") {
			if n, err := strconv.ParseInt(string(v), 10, 64); err == nil {
				return wrap(n, "Int64"), nil
			}
			if n, err := strconv.ParseUint(string(v), 10, 64); err == nil {
				return wrap(n, "UInt64"), nil
			}
			return chcol.Dynamic{}, fmt.Errorf("JSON integer outside 64-bit range; preserve it as a decimal string")
		}
		n, err := strconv.ParseFloat(string(v), 64)
		if err != nil {
			return chcol.Dynamic{}, err
		}
		return wrap(n, "Float64"), nil
	case []any:
		result := make([]chcol.Dynamic, len(v))
		for i, item := range v {
			next, err := typedDynamic(item, depth+1)
			if err != nil {
				return chcol.Dynamic{}, err
			}
			result[i] = next
		}
		return wrap(result, "Array(Dynamic)"), nil
	case map[string]any:
		result := make(map[string]chcol.Dynamic, len(v))
		for key, item := range v {
			next, err := typedDynamic(item, depth+1)
			if err != nil {
				return chcol.Dynamic{}, err
			}
			result[key] = next
		}
		return wrap(result, "Map(String, Dynamic)"), nil
	default:
		return chcol.Dynamic{}, fmt.Errorf("unsupported Dynamic JSON value %T", value)
	}
}
