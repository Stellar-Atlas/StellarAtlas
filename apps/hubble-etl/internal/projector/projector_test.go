package projector

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
	"github.com/stellar/stellar-etl/v2/internal/transform"
)

type countingEmitter map[string]int

func (c countingEmitter) Emit(
	_ context.Context,
	dataset string,
	_ uint32,
	_ any,
) error {
	c[dataset]++
	return nil
}

type sorobanFixtureEmitter struct {
	countingEmitter
	invocations      map[int64]bool
	events           []transform.ContractEventOutput
	changedContracts map[string]bool
}

func (e *sorobanFixtureEmitter) Emit(ctx context.Context, dataset string, sequence uint32, row any) error {
	if err := e.countingEmitter.Emit(ctx, dataset, sequence, row); err != nil {
		return err
	}
	switch typed := row.(type) {
	case transform.OperationOutput:
		if typed.Type == int32(xdr.OperationTypeInvokeHostFunction) {
			e.invocations[typed.TransactionID] = true
		}
	case transform.ContractEventOutput:
		e.events = append(e.events, typed)
	case transform.ContractDataOutput:
		if !typed.Deleted && typed.KeyDecoded != nil && typed.ValDecoded != nil {
			e.changedContracts[typed.ContractId] = true
		}
	}
	return nil
}

func isSetPriceReturn(topics []any) bool {
	encoded, err := json.Marshal(topics)
	if err != nil {
		return false
	}
	var decoded []struct {
		Symbol string `json:"symbol"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return false
	}
	return len(decoded) == 2 && decoded[0].Symbol == "fn_return" && decoded[1].Symbol == "set_price"
}

func TestProjectsRealLedgerCloseMetaThroughOfficialTransforms(t *testing.T) {
	t.Parallel()
	batch, err := lcmbatch.DecodeFile(
		filepath.Join(
			"..",
			"..",
			"..",
			"full-history-etl",
			"internal",
			"testdata",
			"FCD285FF--53312000.xdr.zstd",
		),
		53_312_000,
		53_312_000,
		lcmbatch.Limits{
			MaxCompressedBytes:    1 << 20,
			MaxUncompressedBytes:  64 << 20,
			MaxDecodedMemoryBytes: 64 << 20,
			MaxLedgers:            1,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Close()
	counts := countingEmitter{}
	emitter := &sorobanFixtureEmitter{countingEmitter: counts, invocations: map[int64]bool{}, changedContracts: map[string]bool{}}
	projector, err := New(
		"Public Global Stellar Network ; September 2015",
		emitter,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := batch.ForEach(
		64<<20,
		func(meta xdr.LedgerCloseMeta) error {
			return projector.ProcessLedger(context.Background(), meta)
		},
	); err != nil {
		t.Fatal(err)
	}
	// Classic fee events must not satisfy this assertion: require an event in an
	// InvokeHostFunction transaction from a contract with decoded state changes.
	matchedEvents := 0
	for _, event := range emitter.events {
		if emitter.invocations[event.TransactionID] && emitter.changedContracts[event.ContractId] &&
			event.Successful && event.InSuccessfulContractCall &&
			event.Type == int32(xdr.ContractEventTypeDiagnostic) && isSetPriceReturn(event.TopicsDecoded) && event.DataDecoded != nil {
			matchedEvents++
		}
	}
	if len(emitter.invocations) != 1 || matchedEvents != 1 || counts["contract_data"] != 10 || counts["ttl"] != 9 {
		t.Fatalf("Soroban extraction missing: invocations=%d matched events=%d counts=%v", len(emitter.invocations), matchedEvents, counts)
	}
	t.Logf("Soroban: %d invocation transactions, %d decoded set_price return events, %d contract state rows, %d TTL rows", len(emitter.invocations), matchedEvents, counts["contract_data"], counts["ttl"])
	if counts["history_ledgers"] != 1 {
		t.Fatalf("projected %d ledgers, want 1", counts["history_ledgers"])
	}
	if counts["history_transactions"] != 163 ||
		counts["ledger_transactions"] != 163 {
		t.Fatalf(
			"projected transactions=%d ledger_transactions=%d, want 163 each",
			counts["history_transactions"],
			counts["ledger_transactions"],
		)
	}
	if counts["history_operations"] == 0 || counts["history_effects"] == 0 {
		t.Fatalf("expected operations and effects, got %#v", counts)
	}
}
