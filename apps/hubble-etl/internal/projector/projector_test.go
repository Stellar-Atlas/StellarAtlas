package projector

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/pkg/lcmbatch"
	"github.com/stellar/go-stellar-sdk/xdr"
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
	projector, err := New(
		"Public Global Stellar Network ; September 2015",
		counts,
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
