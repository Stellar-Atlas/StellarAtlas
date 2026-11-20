package output

import (
	"fmt"

	"github.com/Stellar-Atlas/StellarAtlas/apps/full-history-etl/internal/model"
)

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
