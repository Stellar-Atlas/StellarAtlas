package clickhouse

import (
	"encoding/base64"
	"reflect"
	"testing"

	"github.com/stellar/go-stellar-xdr-json/xdrjson"
	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// Actual retained event at ledger 63,490,232, transaction bd94f494...cd6dd44.
// This checks decoded-value fidelity, not whether the transaction was Soroban.
func TestRetainedModernSCValNumericStringRoundTrip(t *testing.T) {
	const scval = "AAAAEQAAAAEAAAACAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAFKu/gAAAADwAAAAt0b19tdXhlZF9pZAAAAAAOAAAACTk5ODI4MTQxNwAAAA=="
	const expected = `{"map":[{"key":{"symbol":"amount"},"val":{"i128":"86700000"}},{"key":{"symbol":"to_muxed_id"},"val":{"string":"998281417"}}]}`
	raw, err := base64.StdEncoding.DecodeString(scval)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := xdrjson.Decode(xdrjson.ScVal, raw)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decodeJSON(t, decoded), decodeJSON(t, []byte(expected))) {
		t.Fatal("stored live value differs from original SCVal XDR")
	}
	row := []byte(`{"data_decoded":` + string(decoded) + `,"data":"` + scval + `"}`)
	encoded, err := encodeNativeRows([]schema.Column{{Name: "data_decoded", Type: "Dynamic"}, {Name: "data", Type: "String"}}, row)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := readNativeOffline(t, encoded), decodeJSON(t, row); !reflect.DeepEqual(got, want) {
		t.Fatalf("real XDR round trip changed types/values: %#v", got)
	}
}
