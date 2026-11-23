package output

import (
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
)

// Check the actual compiled row model, not just the dataset name. In
// particular v6 event/change schemas cannot be emitted by the v3 writers.
func SupportsProjection(s Specification) bool {
	for _, native := range specifications {
		if native.Dataset == "ledger-entry-changes" && s.SchemaVersion == CompactLedgerEntryChangeSchemaVersion {
			native.SchemaVersion = CompactLedgerEntryChangeSchemaVersion
		}
		if s == native {
			return true
		}
	}
	return false
}

func OpenProjection(directory string, maxBytes int64, s Specification) (*Collection, error) {
	if !SupportsProjection(s) || maxBytes <= 0 {
		return nil, fmt.Errorf("unsupported projection writer or budget")
	}
	b := &byteBudget{max: maxBytes}
	c := &Collection{}
	var err error
	var sink lifecycle
	switch s.Dataset {
	case "ledgers":
		c.Ledgers, err = newSink[model.Ledger](directory, b, s)
		sink = c.Ledgers
	case "transactions":
		c.Transactions, err = newSink[model.Transaction](directory, b, s)
		sink = c.Transactions
	case "operations":
		c.Operations, err = newSink[model.Operation](directory, b, s)
		sink = c.Operations
	case "transaction-results":
		c.TransactionResults, err = newSink[model.TransactionResult](directory, b, s)
		sink = c.TransactionResults
	case "transaction-meta":
		c.TransactionMeta, err = newSink[model.TransactionMeta](directory, b, s)
		sink = c.TransactionMeta
	case "contract-events":
		c.ContractEvents, err = newSink[model.ContractEvent](directory, b, s)
		sink = c.ContractEvents
	case "ledger-entry-changes":
		c.LedgerEntryChanges, err = newLedgerEntryChangeSink(directory, b, s, s.SchemaVersion == CompactLedgerEntryChangeSchemaVersion)
		sink = c.LedgerEntryChanges
	case "account-state-changes":
		c.AccountStateChanges, err = newSink[model.AccountStateChange](directory, b, s)
		sink = c.AccountStateChanges
	case "trustline-state-changes":
		c.TrustlineStateChanges, err = newSink[model.TrustlineStateChange](directory, b, s)
		sink = c.TrustlineStateChanges
	default:
		return nil, fmt.Errorf("unsupported projection %q", s.Dataset)
	}
	if err != nil {
		return nil, err
	}
	c.sinks = []lifecycle{sink}
	return c, nil
}

// OpenTransactionReconstructionCollection opens only the three transaction
// projections for offline reconstruction, not a complete ingestion output set.
func OpenTransactionReconstructionCollection(directory string, maxBytes int64) (*Collection, error) {
	if maxBytes <= 0 {
		return nil, fmt.Errorf("output byte limit must be positive")
	}
	budget := &byteBudget{max: maxBytes}
	collection := &Collection{}
	var err error
	defer func() {
		if err != nil {
			collection.Abort()
		}
	}()
	if collection.Transactions, err = newSink[model.Transaction](directory, budget, specifications[1]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.Transactions)
	if collection.TransactionResults, err = newSink[model.TransactionResult](directory, budget, specifications[3]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.TransactionResults)
	if collection.Operations, err = newSink[model.Operation](directory, budget, specifications[2]); err != nil {
		return nil, err
	}
	collection.sinks = append(collection.sinks, collection.Operations)
	return collection, nil
}
