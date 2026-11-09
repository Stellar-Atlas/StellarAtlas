package output

import "github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"

const CompactLedgerEntryChangeSchemaVersion = "stellar-atlas.full-history.ledger-entry-changes.v4"

type ledgerEntryChangeSink interface {
	lifecycle
	Write(model.LedgerEntryChange) error
}

type compactLedgerEntryChangeSink struct {
	*Sink[model.CompactLedgerEntryChange]
}

func (s compactLedgerEntryChangeSink) Write(row model.LedgerEntryChange) error {
	return s.Sink.Write(row.Compact())
}

func newLedgerEntryChangeSink(directory string, budget *byteBudget, spec Specification, compact bool) (ledgerEntryChangeSink, error) {
	if !compact {
		return newSink[model.LedgerEntryChange](directory, budget, spec)
	}
	spec.SchemaVersion = CompactLedgerEntryChangeSchemaVersion
	sink, err := newSink[model.CompactLedgerEntryChange](directory, budget, spec)
	if err != nil {
		return nil, err
	}
	return compactLedgerEntryChangeSink{sink}, nil
}
