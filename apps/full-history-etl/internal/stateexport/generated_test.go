package stateexport_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
)

func TestAccountExportPreservesBinaryAndJSONTypes(t *testing.T) {
	binaryXDR := []byte{0x00, 0xff, 0xfe, 0x80, 0x41, 0x00, 0xc3, 0x28}
	row := model.AccountStateChange{
		LedgerSequence: math.MaxInt64, TransactionIndex: 9007199254740993, ChangeIndex: 7,
		TransactionHash: "abc", Reason: "operation", ChangeType: -2, ChangeTypeString: "updated",
		Deleted: true, LedgerKeySHA256: "def", StateEntryXDR: string(binaryXDR),
		LastModifiedLedger: math.MaxInt64, ClosedAtUnixMillis: math.MinInt64,
		AccountID: "GACCOUNT", Balance: math.MinInt64, BuyingLiabilities: math.MaxInt64,
		SellingLiabilities: -9007199254740993, SequenceNumber: math.MaxInt64,
		SubentryCount: 2, Flags: math.MaxInt64, HomeDomain: "example.test",
		MasterWeight: 1, LowThreshold: 2, MediumThreshold: 3, HighThreshold: 4,
		SponsoredEntryCount: 5, SponsoringEntryCount: 6, SignerCount: 2,
		SignerKeys: []string{"GA", "GB"}, SignerWeights: []int32{1, math.MaxInt32},
		SignerSponsors: []string{"", "GSPONSOR"},
	}
	path := writeParquet(t, "account-state-changes.parquet", []model.AccountStateChange{row})
	var stdout, stderr bytes.Buffer
	code := stateexport.Main([]string{"--dataset", "account-state-changes", "--input", path}, &stdout, &stderr)
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("export failed: code=%d stderr=%q", code, stderr.String())
	}
	records := decodeLines(t, stdout.Bytes(), stateexport.MaxNDJSONLineBytes)
	if len(records) != 3 {
		t.Fatalf("got %d records, expected header, row, completion", len(records))
	}
	if records[0].Type != "header" || records[0].Version != stateexport.Version || records[0].Dataset != "account-state-changes" {
		t.Fatalf("unexpected header: %+v", records[0])
	}
	if records[0].SourceSHA256 != fileSHA256(t, path) {
		t.Fatalf("header source digest %q does not match its input", records[0].SourceSHA256)
	}
	if records[1].Type != "row" || records[1].Dataset != records[0].Dataset {
		t.Fatalf("unexpected row envelope: %+v", records[1])
	}
	values := records[1].Value
	assertRawJSON(t, values, "ledgerSequence", `"9223372036854775807"`)
	assertRawJSON(t, values, "transactionIndex", `"9007199254740993"`)
	assertRawJSON(t, values, "balance", `"-9223372036854775808"`)
	assertRawJSON(t, values, "sellingLiabilities", `"-9007199254740993"`)
	assertRawJSON(t, values, "closedAtUnixMillis", `"-9223372036854775808"`)
	assertRawJSON(t, values, "changeType", `-2`)
	assertRawJSON(t, values, "deleted", `true`)
	assertRawJSON(t, values, "operationIndex", `null`)
	assertRawJSON(t, values, "upgradeIndex", `null`)
	assertRawJSON(t, values, "sponsor", `null`)
	assertRawJSON(t, values, "sequenceLedger", `null`)
	assertRawJSON(t, values, "sequenceTime", `null`)
	assertRawJSON(t, values, "inflationDestination", `null`)
	assertRawJSON(t, values, "signerWeights", `[1,2147483647]`)
	assertRawJSON(t, values, "signerSponsors", `[null,"GSPONSOR"]`)
	var encodedXDR string
	if err := json.Unmarshal(values["stateEntryXdrBase64"], &encodedXDR); err != nil {
		t.Fatalf("decode XDR JSON string: %v", err)
	}
	decodedXDR, err := base64.StdEncoding.DecodeString(encodedXDR)
	if err != nil || !bytes.Equal(decodedXDR, binaryXDR) {
		t.Fatalf("XDR bytes changed: got %x err=%v, expected %x", decodedXDR, err, binaryXDR)
	}
	if records[2].Type != "complete" || records[2].Dataset != records[0].Dataset || records[2].RecordCount != "1" {
		t.Fatalf("unexpected completion: %+v", records[2])
	}
}

func TestExportRejectsWrongDatasetSchemaBeforeHeader(t *testing.T) {
	path := writeParquet(t, "trustline-state-changes.parquet", []model.TrustlineStateChange{{}})
	var stdout, stderr bytes.Buffer
	code := stateexport.Main([]string{"--dataset", "account-state-changes", "--input", path}, &stdout, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "validate account-state-changes parquet") {
		t.Fatalf("expected schema mismatch, code=%d stderr=%q", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("schema mismatch wrote a header: %q", stdout.String())
	}
}

func TestExportRejectsRowOverOneMiBWithoutWritingIt(t *testing.T) {
	row := model.AccountStateChange{StateEntryXDR: strings.Repeat("\xff", 800_000)}
	path := writeParquet(t, "account-state-changes.parquet", []model.AccountStateChange{row})
	var stdout, stderr bytes.Buffer
	code := stateexport.Main([]string{"--dataset", "account-state-changes", "--input", path}, &stdout, &stderr)
	if code == 0 || !strings.Contains(stderr.String(), "NDJSON line") {
		t.Fatalf("expected line-limit error, code=%d stderr=%q", code, stderr.String())
	}
	records := decodeLines(t, stdout.Bytes(), stateexport.MaxNDJSONLineBytes)
	if len(records) != 1 || records[0].Type != "header" {
		t.Fatalf("oversized row output was not header-only: %+v", records)
	}
}
