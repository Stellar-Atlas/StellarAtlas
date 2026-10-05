package projector

import (
	"testing"

	"github.com/stellar/go-stellar-sdk/processors/token_transfer"
	"github.com/stellar/go-stellar-sdk/xdr"
	"google.golang.org/protobuf/encoding/protojson"
)

// Observed in retained public ledger 33968359, protocol 15. Its text memo is
// not a numeric muxed ID, and the zero-key destination is a valid G-address.
const recordedLegacyTransfer = `{"meta":{"ledgerSequence":33968359,"closedAt":"2021-02-12T14:47:13Z","txHash":"b342bf88a35c66ff9ee0099eb5c095adf87015552c0214738e11a21b39d4ef43","transactionIndex":200,"operationIndex":1,"contractAddress":"CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA","toMuxedInfo":{"text":""}},"transfer":{"from":"GAZSPN35UODWGQ3E3VYKVMP7T3OPBEQZJE3QJLXPF6VKWAZP7TYWCKQX","to":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF","asset":{"native":true},"amount":"7799000000"}}`

func legacyTransferFixture(t *testing.T) (*token_transfer.TokenTransferEvent, xdr.LedgerCloseMeta) {
	t.Helper()
	event := &token_transfer.TokenTransferEvent{}
	if err := protojson.Unmarshal([]byte(recordedLegacyTransfer), event); err != nil {
		t.Fatal(err)
	}
	meta := xdr.LedgerCloseMeta{V: 0, V0: &xdr.LedgerCloseMetaV0{}}
	meta.V0.LedgerHeader.Header.LedgerSeq = 33968359
	meta.V0.LedgerHeader.Header.LedgerVersion = 15
	meta.V0.LedgerHeader.Header.ScpValue.CloseTime = xdr.TimePoint(event.Meta.ClosedAt.Seconds)
	return event, meta
}

func TestRecordedLegacyTextMemoDoesNotInventMuxedID(t *testing.T) {
	t.Parallel()
	event, meta := legacyTransferFixture(t)
	row, err := legacyTokenTransfer(event, meta)
	if err != nil {
		t.Fatal(err)
	}
	if row.ToMuxed.Valid || row.ToMuxedID.Valid {
		t.Fatalf("text memo fabricated muxed metadata: %+v", row)
	}
	if row.To.String != event.GetTransfer().To || row.From.String != event.GetTransfer().From ||
		row.AmountRaw != "7799000000" || row.Asset != "native" || row.LedgerSequence != 33968359 ||
		row.TransactionHash != event.Meta.TxHash || !row.OperationID.Valid || !row.ClosedAt.Equal(meta.ClosedAt()) {
		t.Fatalf("recorded transfer evidence changed: %+v", row)
	}
}

func TestLegacyNonNumericDestinationMemosAreNotMuxedIDs(t *testing.T) {
	t.Parallel()
	for name, memo := range map[string]*token_transfer.MuxedInfo{
		"absent": nil,
		"empty":  {},
		"text":   {Content: &token_transfer.MuxedInfo_Text{Text: "123"}},
		"hash":   {Content: &token_transfer.MuxedInfo_Hash{Hash: make([]byte, 32)}},
	} {
		t.Run(name, func(t *testing.T) {
			event, meta := legacyTransferFixture(t)
			event.Meta.ToMuxedInfo = memo
			row, err := legacyTokenTransfer(event, meta)
			if err != nil {
				t.Fatal(err)
			}
			if row.ToMuxed.Valid || row.ToMuxedID.Valid {
				t.Fatal("non-ID memo became muxed ID")
			}
		})
	}
}

func TestLegacyNumericMuxedIDPreservesZeroKeyAndUint64(t *testing.T) {
	t.Parallel()
	for _, destination := range []string{
		"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
		"GAZSPN35UODWGQ3E3VYKVMP7T3OPBEQZJE3QJLXPF6VKWAZP7TYWCKQX",
	} {
		for _, id := range []uint64{0, 42, ^uint64(0)} {
			event, meta := legacyTransferFixture(t)
			event.GetTransfer().To = destination
			event.Meta.ToMuxedInfo = &token_transfer.MuxedInfo{Content: &token_transfer.MuxedInfo_Id{Id: id}}
			row, err := legacyTokenTransfer(event, meta)
			if err != nil {
				t.Fatal(err)
			}
			if !row.ToMuxed.Valid || !row.ToMuxedID.Valid {
				t.Fatal("numeric ID missing")
			}
			decoded, err := xdr.AddressToMuxedAccount(row.ToMuxed.String)
			if err != nil {
				t.Fatal(err)
			}
			want, err := xdr.MuxedAccountFromAccountId(destination, id)
			if err != nil {
				t.Fatal(err)
			}
			if decoded.MustMed25519() != want.MustMed25519() {
				t.Fatal("numeric ID or key changed")
			}
		}
	}
}

func TestLegacyNumericMuxedIDRejectsInvalidRecipient(t *testing.T) {
	t.Parallel()
	for _, destination := range []string{"", "not-an-address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHA", "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"} {
		event, meta := legacyTransferFixture(t)
		event.GetTransfer().To = destination
		event.Meta.ToMuxedInfo = &token_transfer.MuxedInfo{Content: &token_transfer.MuxedInfo_Id{Id: 42}}
		if _, err := legacyTokenTransfer(event, meta); err == nil {
			t.Fatalf("accepted invalid G recipient %q", destination)
		}
	}
}
