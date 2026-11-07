package clickhouse

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/go-stellar-xdr-json/xdrjson"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

type namedRawMessage json.RawMessage

func TestTypedRawMessageLeafParity(t *testing.T) {
	values := []json.RawMessage{
		nil, json.RawMessage("null"), json.RawMessage(" \n null\t"),
		json.RawMessage(`true`), json.RawMessage(`"9007199254740993"`),
		json.RawMessage(`-9223372036854775808`), json.RawMessage(`9223372036854775807`),
		json.RawMessage(`18446744073709551615`), json.RawMessage(`9007199254740993`),
		json.RawMessage(`-0`), json.RawMessage(`1e0`), json.RawMessage(`1.25`),
		json.RawMessage(`{}`), json.RawMessage(`[]`),
		json.RawMessage(`{"a":1,"a":2,"null":null,"nested":["001",true,18446744073709551615]}`),
		json.RawMessage(`"\ud800<>&\u2028"`), json.RawMessage{'"', 255, '"'},
	}
	for i, raw := range values {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			for _, value := range []any{raw, []any{raw}, map[string]any{"leaf": raw}} {
				want, we := legacyPreparedDynamic(value)
				got, ge := prepareRetainedTypedDynamic(value)
				if we != nil || ge != nil || !reflect.DeepEqual(want, got) {
					t.Fatalf("retained leaf differs: legacy=%#v/%v prepared=%#v/%v", want, we, got, ge)
				}
				got, ge = prepareTypedDynamic(value)
				if ge != nil || !reflect.DeepEqual(want, got) {
					t.Fatal("non-retained helper changed normalization", ge)
				}
			}
		})
	}
}

func TestTypedRawMessageInvalidAndDepthFallback(t *testing.T) {
	for _, raw := range []json.RawMessage{
		{}, json.RawMessage(" "), json.RawMessage(`{`), json.RawMessage(`null true`),
		json.RawMessage(`1 trailing`), json.RawMessage(`NaN`),
		json.RawMessage(`18446744073709551616`), json.RawMessage(`-9223372036854775809`),
		json.RawMessage(`1e999`),
	} {
		if _, err := prepareRetainedTypedDynamic(raw); !errors.Is(err, errTypedNativeUnsupported) {
			t.Fatalf("invalid/unsupported leaf did not decline: %q: %v", raw, err)
		}
		_, want := legacyPreparedDynamic(raw)
		_, got := prepareTypedDynamic(raw)
		if want == nil || got == nil || want.Error() != got.Error() {
			t.Fatalf("legacy error changed for %q: %v / %v", raw, want, got)
		}
	}
	for _, nested := range []int{0, 1, 2} {
		var value any = json.RawMessage(strings.Repeat("[", 127) + "0" + strings.Repeat("]", 127))
		for i := 0; i < nested; i++ {
			value = []any{value}
		}
		want, we := legacyPreparedDynamic(value)
		got, ge := prepareRetainedTypedDynamic(value)
		if we == nil && (ge != nil || !reflect.DeepEqual(want, got)) {
			t.Fatal("supported combined depth changed", nested, ge)
		}
		if we != nil && !errors.Is(ge, errTypedNativeUnsupported) {
			t.Fatal("raw leaf reset combined depth limit", nested, we, ge)
		}
	}
	for _, value := range []any{namedRawMessage(`{"x":1}`), []byte(`{"x":1}`)} {
		if _, err := prepareRetainedTypedDynamic(value); !errors.Is(err, errTypedNativeUnsupported) {
			t.Fatalf("broadened custom byte type %T: %v", value, err)
		}
	}
}

// Mirrors pinned transform/contract_events.go serializeScVal: MarshalBinary,
// base64 source and xdrjson.Decode's exact json.RawMessage dynamic value.
func rawMessageScVal(t *testing.T, value xdr.ScVal) (string, json.RawMessage) {
	t.Helper()
	raw, err := value.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := xdrjson.Decode(xdrjson.ScVal, raw)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(raw), decoded
}

func rawMessageEvent(t *testing.T) transform.ContractEventOutput {
	t.Helper()
	n := xdr.Uint64(math.MaxUint64)
	data, decoded := rawMessageScVal(t, xdr.ScVal{Type: xdr.ScValTypeScvU64, U64: &n})
	event := nativeTableFixture()
	event.Data, event.DataDecoded = data, decoded
	event.Topics, event.TopicsDecoded = []any{data}, []any{decoded}
	return event
}

func TestTypedRawMessageEventWriterParityAndOwnership(t *testing.T) {
	for _, pending := range []int{0, 2} {
		t.Run(fmt.Sprintf("pending=%d", pending), func(t *testing.T) {
			var captures [2]effectsTestCapture
			for mode := range captures {
				w := nativeTestWriter(t, false, mode == 1, pending, 3, 0, &captures[mode])
				for i := 0; i < 5; i++ {
					event := rawMessageEvent(t)
					event.TransactionID += int64(i)
					body, err := w.PrepareRow("history_contract_events", event)
					if err != nil {
						t.Fatal(err)
					}
					before := bytes.Clone(body)
					p, err := w.PrepareNativeRow("history_contract_events", event)
					if err != nil || mode == 1 && p == nil {
						t.Fatal("real decoded event shape did not prepare", err)
					}
					if i%2 == 0 {
						if err := w.Emit(context.Background(), "history_contract_events", 1, event); err != nil {
							t.Fatal(err)
						}
					} else {
						// Neither worker result may borrow caller-owned decoded bytes.
						for _, raw := range []json.RawMessage{event.DataDecoded.(json.RawMessage), event.TopicsDecoded[0].(json.RawMessage)} {
							for j := range raw {
								raw[j] = 'x'
							}
						}
						if err := w.EmitPreparedNative(context.Background(), "history_contract_events", 1, body, p); err != nil {
							t.Fatal(err)
						}
					}
					if !bytes.Equal(before, body) {
						t.Fatal("retained JSON changed")
					}
					if p != nil && p.RetainedBytes() < len(body) {
						t.Fatal("owned prepared values missing budget")
					}
				}
				if err := w.Flush(context.Background()); err != nil {
					t.Fatal(err)
				}
				if w.TotalRows() != 5 || w.DatasetWriteStats().Rows != 5 || w.DatasetWriteStats().Chunks != 2 {
					t.Fatal("logical rows, ACKs or chunks changed")
				}
			}
			effectsTestCompare(t, captures[0].calls, captures[1].calls, true)
		})
	}
}

func TestTypedRawMessageEventFallbackBoundaries(t *testing.T) {
	var capture effectsTestCapture
	w := nativeTestWriter(t, false, true, 0, 3, 0, &capture)
	event := rawMessageEvent(t)
	if p, err := w.PrepareNativeRow("history_contract_events", &event); err != nil || p != nil {
		t.Fatal("pointer support broadened", err)
	}
	for _, raw := range []json.RawMessage{{}, json.RawMessage(`null true`), json.RawMessage(`18446744073709551616`)} {
		event := rawMessageEvent(t)
		event.DataDecoded = raw
		if p, err := w.PrepareNativeRow("history_contract_events", event); err != nil || p != nil {
			t.Fatal("invalid/unsupported event leaf must retain whole-row fallback", err)
		}
	}
	custom := &typedFallbackStatefulMarshaler{failAfterFirst: true}
	event.TopicsDecoded = []any{event.DataDecoded, custom}
	body, err := w.PrepareRow("history_contract_events", event)
	if err != nil {
		t.Fatal(err)
	}
	p, err := w.PrepareNativeRow("history_contract_events", event)
	if err != nil || p != nil || custom.calls != 1 {
		t.Fatal("custom marshaler fallback changed", err, custom.calls)
	}
	if err := w.EmitPreparedNative(context.Background(), "history_contract_events", 1, body, p); err != nil {
		t.Fatal(err)
	}
	if err := w.Flush(context.Background()); err != nil || custom.calls != 1 {
		t.Fatal("custom marshaler repeated", err, custom.calls)
	}
}
