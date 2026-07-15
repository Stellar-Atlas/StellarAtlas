package stateexport_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/stateexport"
)

type ledgerV2WrongTransactionCount struct {
	LedgerSequence                int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	LedgerCloseMetaVersion        int32  `parquet:"name=ledger_close_meta_version, type=INT32"`
	LedgerHash                    string `parquet:"name=ledger_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	PreviousLedgerHash            string `parquet:"name=previous_ledger_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionSetHash            string `parquet:"name=transaction_set_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionResultSetHash      string `parquet:"name=transaction_result_set_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	BucketListHash                string `parquet:"name=bucket_list_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	ClosedAtUnixMillis            int64  `parquet:"name=closed_at_unix_millis, type=INT64, convertedtype=TIMESTAMP_MILLIS"`
	ProtocolVersion               int64  `parquet:"name=protocol_version, type=INT64, convertedtype=UINT_64"`
	TransactionCount              int32  `parquet:"name=transaction_count, type=INT32"`
	SuccessfulTransactionCount    int64  `parquet:"name=successful_transaction_count, type=INT64, convertedtype=UINT_64"`
	FailedTransactionCount        int64  `parquet:"name=failed_transaction_count, type=INT64, convertedtype=UINT_64"`
	OperationCount                int64  `parquet:"name=operation_count, type=INT64, convertedtype=UINT_64"`
	SuccessfulOperationCount      int64  `parquet:"name=successful_operation_count, type=INT64, convertedtype=UINT_64"`
	TotalCoins                    int64  `parquet:"name=total_coins, type=INT64"`
	FeePool                       int64  `parquet:"name=fee_pool, type=INT64"`
	BaseFee                       int64  `parquet:"name=base_fee, type=INT64, convertedtype=UINT_64"`
	BaseReserve                   int64  `parquet:"name=base_reserve, type=INT64, convertedtype=UINT_64"`
	MaxTransactionSetSize         int64  `parquet:"name=max_transaction_set_size, type=INT64, convertedtype=UINT_64"`
	SorobanFeeWrite1KB            int64  `parquet:"name=soroban_fee_write_1kb, type=INT64"`
	HasSorobanFeeWrite1KB         bool   `parquet:"name=has_soroban_fee_write_1kb, type=BOOLEAN"`
	TotalLiveSorobanStateBytes    int64  `parquet:"name=total_live_soroban_state_bytes, type=INT64, convertedtype=UINT_64"`
	HasTotalLiveSorobanStateBytes bool   `parquet:"name=has_total_live_soroban_state_bytes, type=BOOLEAN"`
	EvictedLedgerKeyCount         int64  `parquet:"name=evicted_ledger_key_count, type=INT64, convertedtype=UINT_64"`
}

func TestLedgerExportRequiresExactV2Schema(t *testing.T) {
	validPath := writeParquet(t, "ledgers-v2.parquet", []model.Ledger{validLedger(1, "a")})
	var validOutput bytes.Buffer
	if count, err := stateexport.Export(context.Background(), stateexport.Config{
		Dataset: stateexport.Ledgers, InputPath: validPath,
	}, &validOutput); err != nil || count != 1 {
		t.Fatalf("exact v2 ledger schema failed: count=%d err=%v", count, err)
	}

	wrongPath := writeParquet(t, "ledgers-wrong.parquet", []ledgerV2WrongTransactionCount{{LedgerSequence: 1}})
	var wrongOutput bytes.Buffer
	_, err := stateexport.Export(context.Background(), stateexport.Config{
		Dataset: stateexport.Ledgers, InputPath: wrongPath,
	}, &wrongOutput)
	if err == nil || !strings.Contains(err.Error(), "schema element") {
		t.Fatalf("wrong ledger schema returned %v", err)
	}
	if wrongOutput.Len() != 0 {
		t.Fatalf("wrong ledger schema wrote output: %q", wrongOutput.String())
	}
}

func TestLedgerExportIsDeterministicAndCountsRows(t *testing.T) {
	hashA, hashB, hashC := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)
	hashD, hashE, hashF := strings.Repeat("d", 64), strings.Repeat("e", 64), strings.Repeat("f", 64)
	hash0, hash1, hash2, hash3 := strings.Repeat("0", 64), strings.Repeat("1", 64), strings.Repeat("2", 64), strings.Repeat("3", 64)
	rows := []model.Ledger{
		{
			LedgerSequence: math.MaxInt64, LedgerHash: hashA, PreviousLedgerHash: hashB,
			TransactionSetHash: hashC, TransactionResultSetHash: hashD, BucketListHash: hashE,
			ProtocolVersion: 23, ClosedAtUnixMillis: 1_720_000_000_123, TransactionCount: 17,
			LedgerCloseMetaVersion: 2, OperationCount: 99,
		},
		{
			LedgerSequence: 2, LedgerHash: hashF, PreviousLedgerHash: hash0,
			TransactionSetHash: hash1, TransactionResultSetHash: hash2, BucketListHash: hash3,
			ProtocolVersion: 24, ClosedAtUnixMillis: 1_720_000_005_123, TransactionCount: 3,
		},
	}
	path := writeParquet(t, "ledgers.parquet", rows)
	want := fmt.Sprintf(`{"type":"header","version":"stellar-atlas.full-history-state-export.v1","dataset":"ledgers","sourceSha256":"%s"}
{"type":"row","dataset":"ledgers","value":{"ledgerSequence":"9223372036854775807","ledgerHash":"%s","previousLedgerHash":"%s","transactionSetHash":"%s","transactionResultSetHash":"%s","bucketListHash":"%s","protocolVersion":23,"closedAtUnixMillis":"1720000000123","transactionCount":"17"}}
{"type":"row","dataset":"ledgers","value":{"ledgerSequence":"2","ledgerHash":"%s","previousLedgerHash":"%s","transactionSetHash":"%s","transactionResultSetHash":"%s","bucketListHash":"%s","protocolVersion":24,"closedAtUnixMillis":"1720000005123","transactionCount":"3"}}
{"type":"complete","dataset":"ledgers","recordCount":"2"}
`, fileSHA256(t, path), hashA, hashB, hashC, hashD, hashE, hashF, hash0, hash1, hash2, hash3)

	var first, second bytes.Buffer
	firstCount, firstErr := stateexport.Export(context.Background(), stateexport.Config{
		Dataset: stateexport.Ledgers, InputPath: path,
	}, &first)
	secondCount, secondErr := stateexport.Export(context.Background(), stateexport.Config{
		Dataset: stateexport.Ledgers, InputPath: path,
	}, &second)
	if firstErr != nil || secondErr != nil || firstCount != 2 || secondCount != 2 {
		t.Fatalf("ledger exports failed: first=%d/%v second=%d/%v", firstCount, firstErr, secondCount, secondErr)
	}
	if first.String() != want || second.String() != want {
		t.Fatalf("ledger output is not deterministic\nfirst:\n%s\nsecond:\n%s\nwant:\n%s", first.String(), second.String(), want)
	}
	records := decodeLines(t, first.Bytes(), stateexport.MaxNDJSONLineBytes)
	for index, record := range records[1 : len(records)-1] {
		if len(record.Value) != 9 {
			t.Fatalf("row %d emitted %d value fields, expected 9", index, len(record.Value))
		}
	}
}

func TestLedgerExportRejectsInvalidProofFields(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*model.Ledger)
		want   string
	}{
		{name: "uppercase hash", mutate: func(row *model.Ledger) { row.LedgerHash = strings.Repeat("A", 64) }, want: "ledgerHash"},
		{name: "short hash", mutate: func(row *model.Ledger) { row.PreviousLedgerHash = strings.Repeat("a", 63) }, want: "previousLedgerHash"},
		{name: "non-hex hash", mutate: func(row *model.Ledger) { row.TransactionSetHash = strings.Repeat("g", 64) }, want: "transactionSetHash"},
		{name: "protocol overflow", mutate: func(row *model.Ledger) { row.ProtocolVersion = math.MaxInt32 + 1 }, want: "protocolVersion"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			row := validLedger(1, "a")
			test.mutate(&row)
			path := writeParquet(t, "ledgers.parquet", []model.Ledger{row})
			var output bytes.Buffer
			_, err := stateexport.Export(context.Background(), stateexport.Config{
				Dataset: stateexport.Ledgers, InputPath: path,
			}, &output)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("invalid proof field returned %v", err)
			}
			records := decodeLines(t, output.Bytes(), stateexport.MaxNDJSONLineBytes)
			if len(records) != 1 || records[0].Type != "header" {
				t.Fatalf("invalid proof field emitted a row: %+v", records)
			}
		})
	}
}

func TestLedgerExportRejectsMalformedInputAndUnknownDataset(t *testing.T) {
	malformedPath := filepath.Join(t.TempDir(), "ledgers.parquet")
	if err := os.WriteFile(malformedPath, []byte("not parquet"), 0o600); err != nil {
		t.Fatalf("write malformed parquet: %v", err)
	}
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "malformed parquet", args: []string{"--dataset", "ledgers", "--input", malformedPath}, want: "validate ledgers parquet"},
		{name: "unknown dataset", args: []string{"--dataset", "ledger", "--input", malformedPath}, want: "unsupported dataset"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := stateexport.Main(test.args, &stdout, &stderr); code == 0 {
				t.Fatal("invalid ledger export returned success")
			}
			if stdout.Len() != 0 || !strings.Contains(stderr.String(), test.want) {
				t.Fatalf("stdout=%q stderr=%q, expected error containing %q", stdout.String(), stderr.String(), test.want)
			}
		})
	}
}

func validLedger(sequence int64, hashCharacter string) model.Ledger {
	hash := strings.Repeat(hashCharacter, 64)
	return model.Ledger{
		LedgerSequence: sequence, LedgerHash: hash, PreviousLedgerHash: hash,
		TransactionSetHash: hash, TransactionResultSetHash: hash, BucketListHash: hash,
		ProtocolVersion: 23,
	}
}

func assertLowercaseHashFields(t *testing.T, values map[string]json.RawMessage, fields []string) {
	t.Helper()
	for _, field := range fields {
		var decoded string
		if err := json.Unmarshal(values[field], &decoded); err != nil {
			t.Fatalf("%s is not a string: %s", field, values[field])
		}
		if len(decoded) != 64 {
			t.Fatalf("%s has length %d, expected 64", field, len(decoded))
		}
		for _, character := range decoded {
			if !strings.ContainsRune("0123456789abcdef", character) {
				t.Fatalf("%s is not lowercase hexadecimal: %q", field, decoded)
			}
		}
	}
}
