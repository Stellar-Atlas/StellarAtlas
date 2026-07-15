package stateexport_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/app"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
	"github.com/stellar/go-stellar-sdk/xdr"
)

const testNetworkPassphrase = "Public Global Stellar Network ; September 2015"

type absentEvidence struct {
	operation bool
	upgrade   bool
	sponsor   bool
	sequence  bool
	inflation bool
}

func TestRealManifestV8StateExports(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "network=pubnet", "range=53312000-53312000")
	receipt, err := app.Run(context.Background(), app.Config{
		Sources: []app.Source{{
			Path: filepath.Join("..", "testdata", "FCD285FF--53312000.xdr.zstd"), ObjectKey: "pubnet/ledger/53312000.xdr.zstd",
		}},
		TypedOutputRoot: root, OutputPath: outputDirectory, NetworkName: "pubnet",
		NetworkPassphrase: testNetworkPassphrase, StartLedger: 53312000, EndLedger: 53312000,
		MaxCompressedBytes: 1 << 20, MaxUncompressedBytes: 64 << 20,
		MaxDecodedMemoryBytes: 64 << 20, MaxOutputBytes: 128 << 20,
		MaxLedgers: 1, MaxRows: 10_000,
	})
	if err != nil {
		t.Fatalf("generate manifest-v8 fixture output: %v", err)
	}
	assertManifestV8(t, filepath.Join(root, filepath.FromSlash(receipt.ManifestStorageKey)))

	paths := make(map[string]string)
	for _, descriptor := range receipt.Outputs {
		paths[descriptor.Dataset] = filepath.Join(root, filepath.FromSlash(descriptor.StorageKey))
	}
	tests := []struct {
		dataset stateexport.Dataset
		rows    int
		fields  int
	}{
		{dataset: stateexport.AccountStateChanges, rows: 501, fields: 36},
		{dataset: stateexport.TrustlineStateChanges, rows: 187, fields: 27},
	}
	var sawLargeInt bool
	evidence := absentEvidence{}
	for _, test := range tests {
		t.Run(string(test.dataset), func(t *testing.T) {
			var output bytes.Buffer
			if _, err := stateexport.Export(context.Background(), stateexport.Config{
				Dataset: test.dataset, InputPath: paths[string(test.dataset)],
			}, &output); err != nil {
				t.Fatalf("export generated parquet: %v", err)
			}
			records := decodeLines(t, output.Bytes(), stateexport.MaxNDJSONLineBytes)
			if len(records) != test.rows+2 {
				t.Fatalf("got %d envelopes, expected %d", len(records), test.rows+2)
			}
			assertV8EnvelopeBounds(t, records, test.dataset, test.rows)
			for index, record := range records[1 : len(records)-1] {
				if record.Type != "row" || record.Dataset != string(test.dataset) || len(record.Value) != test.fields {
					t.Fatalf("row %d has an invalid envelope or field count: type=%q dataset=%q fields=%d", index, record.Type, record.Dataset, len(record.Value))
				}
				large, absent := assertV8Value(t, test.dataset, record.Value)
				sawLargeInt = sawLargeInt || large
				evidence.operation = evidence.operation || absent.operation
				evidence.upgrade = evidence.upgrade || absent.upgrade
				evidence.sponsor = evidence.sponsor || absent.sponsor
				evidence.sequence = evidence.sequence || absent.sequence
				evidence.inflation = evidence.inflation || absent.inflation
				if index == 0 {
					assertCanonicalXDR(t, record.Value["stateEntryXdrBase64"])
				}
			}
		})
	}
	if !sawLargeInt {
		t.Fatal("manifest-v8 output did not exercise an int64 beyond exact float64 precision")
	}
	if !evidence.operation || !evidence.upgrade || !evidence.sponsor || !evidence.inflation {
		t.Fatalf("manifest-v8 output did not exercise all nullable metadata: %+v", evidence)
	}
}

func assertManifestV8(t *testing.T, path string) {
	t.Helper()
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read generated manifest: %v", err)
	}
	var manifest struct {
		Version string `json:"manifestVersion"`
	}
	if err := json.Unmarshal(encoded, &manifest); err != nil || manifest.Version != "stellar-atlas.full-history-etl.manifest.v8" {
		t.Fatalf("generated output is not manifest v8: version=%q err=%v", manifest.Version, err)
	}
}

func assertV8EnvelopeBounds(t *testing.T, records []decodedEnvelope, dataset stateexport.Dataset, rows int) {
	t.Helper()
	header, completion := records[0], records[len(records)-1]
	if header.Type != "header" || header.Version != stateexport.Version || header.Dataset != string(dataset) {
		t.Fatalf("unexpected first envelope: %+v", header)
	}
	if completion.Type != "complete" || completion.Dataset != string(dataset) || completion.RecordCount != strconv.Itoa(rows) {
		t.Fatalf("unexpected last envelope: %+v", completion)
	}
}

func assertV8Value(t *testing.T, dataset stateexport.Dataset, value map[string]json.RawMessage) (bool, absentEvidence) {
	t.Helper()
	large := assertDecimalFields(t, value, []string{
		"ledgerSequence", "transactionIndex", "changeIndex", "lastModifiedLedger", "closedAtUnixMillis",
	})
	absent := absentEvidence{
		operation: assertNullableDecimal(t, value, "operationIndex"),
		upgrade:   assertNullableDecimal(t, value, "upgradeIndex"),
		sponsor:   assertNullableString(t, value, "sponsor"),
	}
	assertStrings(t, value, []string{"transactionHash", "reason", "changeTypeString", "ledgerKeySha256", "stateEntryXdrBase64"})
	assertInt32s(t, value, []string{"changeType"})
	assertBools(t, value, []string{"deleted"})
	if dataset == stateexport.AccountStateChanges {
		large = assertDecimalFields(t, value, []string{
			"balance", "buyingLiabilities", "sellingLiabilities", "sequenceNumber", "subentryCount", "flags",
			"sponsoredEntryCount", "sponsoringEntryCount", "signerCount",
		}) || large
		assertStrings(t, value, []string{"accountId", "homeDomain"})
		assertInt32s(t, value, []string{"masterWeight", "lowThreshold", "mediumThreshold", "highThreshold"})
		absent.sequence = assertNullablePair(t, value, "sequenceLedger", "sequenceTime")
		absent.inflation = assertNullableString(t, value, "inflationDestination")
		assertAccountArrays(t, value)
	} else {
		large = assertDecimalFields(t, value, []string{"balance", "limit", "buyingLiabilities", "sellingLiabilities", "flags"}) || large
		assertStrings(t, value, []string{"accountId", "assetTypeString", "assetCode", "assetIssuer", "liquidityPoolId"})
		assertInt32s(t, value, []string{"assetType", "liquidityPoolUseCount"})
	}
	return large, absent
}

func assertDecimalFields(t *testing.T, values map[string]json.RawMessage, fields []string) bool {
	t.Helper()
	var large bool
	for _, field := range fields {
		var encoded string
		if err := json.Unmarshal(values[field], &encoded); err != nil {
			t.Fatalf("%s is not a decimal string: %s", field, values[field])
		}
		parsed, err := strconv.ParseInt(encoded, 10, 64)
		if err != nil {
			t.Fatalf("%s is not an int64 decimal: %q", field, encoded)
		}
		large = large || parsed > 1<<53 || parsed < -(1<<53)
	}
	return large
}

func assertStrings(t *testing.T, values map[string]json.RawMessage, fields []string) {
	t.Helper()
	for _, field := range fields {
		var decoded string
		if err := json.Unmarshal(values[field], &decoded); err != nil {
			t.Fatalf("%s is not a string: %s", field, values[field])
		}
	}
}

func assertInt32s(t *testing.T, values map[string]json.RawMessage, fields []string) {
	t.Helper()
	for _, field := range fields {
		var decoded int32
		if err := json.Unmarshal(values[field], &decoded); err != nil {
			t.Fatalf("%s is not an int32 number: %s", field, values[field])
		}
	}
}

func assertBools(t *testing.T, values map[string]json.RawMessage, fields []string) {
	t.Helper()
	for _, field := range fields {
		var decoded bool
		if err := json.Unmarshal(values[field], &decoded); err != nil {
			t.Fatalf("%s is not a boolean: %s", field, values[field])
		}
	}
}

func assertNullableDecimal(t *testing.T, values map[string]json.RawMessage, field string) bool {
	t.Helper()
	if string(values[field]) == "null" {
		return true
	}
	assertDecimalFields(t, values, []string{field})
	return false
}

func assertNullablePair(t *testing.T, values map[string]json.RawMessage, first, second string) bool {
	t.Helper()
	firstAbsent, secondAbsent := assertNullableDecimal(t, values, first), assertNullableDecimal(t, values, second)
	if firstAbsent != secondAbsent {
		t.Fatalf("%s and %s do not have matching nullability", first, second)
	}
	return firstAbsent
}

func assertNullableString(t *testing.T, values map[string]json.RawMessage, field string) bool {
	t.Helper()
	if string(values[field]) == "null" {
		return true
	}
	var decoded string
	if err := json.Unmarshal(values[field], &decoded); err != nil {
		t.Fatalf("%s is not a nullable string: %s", field, values[field])
	}
	return false
}

func assertAccountArrays(t *testing.T, values map[string]json.RawMessage) {
	t.Helper()
	var keys []string
	var weights []int32
	var sponsors []*string
	if json.Unmarshal(values["signerKeys"], &keys) != nil || json.Unmarshal(values["signerWeights"], &weights) != nil ||
		json.Unmarshal(values["signerSponsors"], &sponsors) != nil {
		t.Fatal("signer arrays do not preserve their JSON element types")
	}
	if len(keys) != len(weights) || len(keys) != len(sponsors) {
		t.Fatalf("signer array lengths differ: %d/%d/%d", len(keys), len(weights), len(sponsors))
	}
}

func assertCanonicalXDR(t *testing.T, raw json.RawMessage) {
	t.Helper()
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err != nil {
		t.Fatalf("decode state XDR base64 string: %v", err)
	}
	binary, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode state XDR base64: %v", err)
	}
	var entry xdr.LedgerEntry
	if err := entry.UnmarshalBinary(binary); err != nil {
		t.Fatalf("decode generated LedgerEntry XDR: %v", err)
	}
	reencoded, err := entry.MarshalBinary()
	if err != nil || !bytes.Equal(reencoded, binary) {
		t.Fatalf("LedgerEntry XDR did not round-trip exactly: %v", err)
	}
}
