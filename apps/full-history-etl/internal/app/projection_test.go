package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
	"github.com/stellar/go-stellar-sdk/strkey"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/reader"
)

func TestCompleteEventAndLedgerEntryChangeProjections(t *testing.T) {
	root := t.TempDir()
	outputDirectory := filepath.Join(root, "typed-shard")
	config := fixtureConfig(root, outputDirectory)
	receipt, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("publish fixture shard: %v", err)
	}

	events := readTypedRows[model.ContractEvent](t, datasetPath(t, root, receipt, "contract-events"))
	if len(events) != 21 {
		t.Fatalf("got %d contract events, expected 21", len(events))
	}
	for index, event := range events {
		assertCompleteContractEvent(t, index, event)
	}

	changes := readTypedRows[model.LedgerEntryChange](t, datasetPath(t, root, receipt, "ledger-entry-changes"))
	if len(changes) != 879 {
		t.Fatalf("got %d ledger entry changes, expected 879", len(changes))
	}
	var withPre, withPost int
	for index, change := range changes {
		assertCompleteLedgerEntryChange(t, index, change)
		if change.HasPreEntry {
			withPre++
		}
		if change.HasPostEntry {
			withPost++
		}
	}
	if withPre == 0 || withPost == 0 {
		t.Fatalf("fixture did not exercise both pre and post entry evidence: pre=%d post=%d", withPre, withPost)
	}

	replayed, err := Run(context.Background(), config)
	if err != nil {
		t.Fatalf("recover typed projection: %v", err)
	}
	if !reflect.DeepEqual(receipt, replayed) {
		t.Fatal("projection recovery changed the processing receipt")
	}
}

func assertCompleteContractEvent(t *testing.T, index int, event model.ContractEvent) {
	t.Helper()
	if event.ExtensionVersion != 0 || event.BodyVersion != 0 {
		t.Fatalf("event %d has unsupported encoded version: ext=%d body=%d", index, event.ExtensionVersion, event.BodyVersion)
	}
	if event.HasContractID {
		decoded, err := strkey.Decode(strkey.VersionByteContract, event.ContractID)
		if err != nil || len(decoded) != 32 {
			t.Fatalf("event %d has invalid contract ID %q: %v", index, event.ContractID, err)
		}
	} else if event.ContractID != "" {
		t.Fatalf("event %d has a contract ID without its presence flag", index)
	}

	topicsXDR := []byte(event.TopicsXDR)
	var topics xdr.ScVec
	if err := topics.UnmarshalBinary(topicsXDR); err != nil {
		t.Fatalf("event %d topics are not canonical ScVec XDR: %v", index, err)
	}
	if int64(len(topics)) != event.TopicCount {
		t.Fatalf("event %d topic count is %d, encoded vector contains %d", index, event.TopicCount, len(topics))
	}
	reencodedTopics, err := topics.MarshalBinary()
	if err != nil || !bytes.Equal(reencodedTopics, topicsXDR) {
		t.Fatalf("event %d topics do not round-trip exactly: %v", index, err)
	}

	dataXDR := []byte(event.DataXDR)
	var data xdr.ScVal
	if err := data.UnmarshalBinary(dataXDR); err != nil {
		t.Fatalf("event %d data is not canonical ScVal XDR: %v", index, err)
	}
	if int32(data.Type) != event.DataType || data.Type.String() != event.DataTypeString {
		t.Fatalf("event %d data type metadata does not match encoded data", index)
	}
	reencodedData, err := data.MarshalBinary()
	if err != nil || !bytes.Equal(reencodedData, dataXDR) {
		t.Fatalf("event %d data does not round-trip exactly: %v", index, err)
	}
}

func assertCompleteLedgerEntryChange(t *testing.T, index int, change model.LedgerEntryChange) {
	t.Helper()
	keyXDR := []byte(change.LedgerKeyXDR)
	var key xdr.LedgerKey
	if err := key.UnmarshalBinary(keyXDR); err != nil {
		t.Fatalf("change %d key is not canonical LedgerKey XDR: %v", index, err)
	}
	reencodedKey, err := key.MarshalBinary()
	if err != nil || !bytes.Equal(reencodedKey, keyXDR) {
		t.Fatalf("change %d key does not round-trip exactly: %v", index, err)
	}
	digest := sha256.Sum256(keyXDR)
	if hex.EncodeToString(digest[:]) != change.LedgerKeySHA256 {
		t.Fatalf("change %d key digest does not match key XDR", index)
	}

	preType := assertLedgerEntryImage(t, index, "pre", change.HasPreEntry, change.PreEntryXDR, change.LedgerKeyXDR)
	postType := assertLedgerEntryImage(t, index, "post", change.HasPostEntry, change.PostEntryXDR, change.LedgerKeyXDR)
	if change.HasPreEntry && preType != xdr.LedgerEntryType(change.EntryType) {
		t.Fatalf("change %d pre-entry type does not match row type", index)
	}
	if change.HasPostEntry && postType != xdr.LedgerEntryType(change.EntryType) {
		t.Fatalf("change %d post-entry type does not match row type", index)
	}

	switch xdr.LedgerEntryChangeType(change.ChangeType) {
	case xdr.LedgerEntryChangeTypeLedgerEntryCreated, xdr.LedgerEntryChangeTypeLedgerEntryRestored:
		if change.HasPreEntry || !change.HasPostEntry {
			t.Fatalf("change %d %s must contain only a post-entry", index, change.ChangeTypeString)
		}
	case xdr.LedgerEntryChangeTypeLedgerEntryUpdated:
		if !change.HasPreEntry || !change.HasPostEntry {
			t.Fatalf("change %d updated entry must contain pre and post entries", index)
		}
	case xdr.LedgerEntryChangeTypeLedgerEntryRemoved:
		if !change.HasPreEntry || change.HasPostEntry {
			t.Fatalf("change %d removed entry must contain only a pre-entry", index)
		}
	default:
		t.Fatalf("change %d has unsupported normalized change type %d", index, change.ChangeType)
	}
}

func assertLedgerEntryImage(t *testing.T, index int, side string, present bool, encodedXDR, expectedKeyXDR string) xdr.LedgerEntryType {
	t.Helper()
	encoded := []byte(encodedXDR)
	expectedKey := []byte(expectedKeyXDR)
	if !present {
		if len(encoded) != 0 {
			t.Fatalf("change %d has %s-entry bytes without its presence flag", index, side)
		}
		return 0
	}
	var entry xdr.LedgerEntry
	if err := entry.UnmarshalBinary(encoded); err != nil {
		t.Fatalf("change %d %s-entry is not canonical LedgerEntry XDR: %v", index, side, err)
	}
	reencoded, err := entry.MarshalBinary()
	if err != nil || !bytes.Equal(reencoded, encoded) {
		t.Fatalf("change %d %s-entry does not round-trip exactly: %v", index, side, err)
	}
	key, err := entry.LedgerKey()
	if err != nil {
		t.Fatalf("change %d derive %s-entry key: %v", index, side, err)
	}
	encodedKey, err := key.MarshalBinary()
	if err != nil || !bytes.Equal(encodedKey, expectedKey) {
		t.Fatalf("change %d %s-entry key does not match row key: %v", index, side, err)
	}
	return entry.Data.Type
}

func datasetPath(t *testing.T, root string, receipt ProcessingReceipt, dataset string) string {
	t.Helper()
	for _, descriptor := range receipt.Outputs {
		if descriptor.Dataset == dataset {
			return checkedStoragePath(t, root, descriptor.StorageKey)
		}
	}
	t.Fatalf("receipt does not contain dataset %q", dataset)
	return ""
}

func readTypedRows[T any](t *testing.T, filePath string) []T {
	t.Helper()
	file, err := local.NewLocalFileReader(filePath)
	if err != nil {
		t.Fatalf("open parquet %s: %v", filePath, err)
	}
	parquetReader, err := reader.NewParquetReader(file, new(T), 1)
	if err != nil {
		file.Close()
		t.Fatalf("create parquet reader %s: %v", filePath, err)
	}
	rows := make([]T, int(parquetReader.GetNumRows()))
	if err := parquetReader.Read(&rows); err != nil {
		parquetReader.ReadStop()
		file.Close()
		t.Fatalf("read parquet %s: %v", filePath, err)
	}
	parquetReader.ReadStop()
	if err := file.Close(); err != nil {
		t.Fatalf("close parquet %s: %v", filePath, err)
	}
	return rows
}
