package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

// PrepareRow reads only immutable schema/client flags. It is safe for bounded
// projection workers; it never reads or mutates writer buffers, row ordinals,
// index maps, identity metadata, chunks, or HTTP state. The caller owns the result.
func (w *BatchWriter) PrepareRow(dataset string, row any) ([]byte, error) {
	if _, ok := schema.Lookup(dataset); !ok {
		return nil, fmt.Errorf("unknown Hubble dataset %q", dataset)
	}
	if w.VirtualLedgerTransactions() && dataset == "ledger_transactions" {
		return nil, nil
	}
	if w.client.singleCopyOperations && dataset == "history_operations" {
		var err error
		row, err = singleCopyOperationRow(row)
		if err != nil {
			return nil, err
		}
	}
	encoded, err := json.Marshal(row)
	if err == nil {
		err = validateEncodedObject(encoded)
	}
	if err != nil {
		return nil, fmt.Errorf("encode %s row: %w", dataset, err)
	}
	return encoded, nil
}

// EmitPrepared consumes an immutable PrepareRow result on the single ordered
// writer. Metadata and mutable counters are assigned here, never by workers.
// Column/type validation remains at the unchanged Native/ClickHouse boundary.
func (w *BatchWriter) EmitPrepared(
	ctx context.Context,
	dataset string,
	ledgerSequence uint32,
	body []byte,
) error {
	return w.emitPrepared(ctx, dataset, ledgerSequence, body, nil)
}
func (w *BatchWriter) emitPrepared(ctx context.Context, dataset string, ledgerSequence uint32, body []byte, prepared *PreparedNativeRow) error {
	if err := w.validateRowIdentity(dataset, ledgerSequence); err != nil {
		return err
	}
	if prepared != nil && prepared.dataset != dataset {
		err := fmt.Errorf("prepared Native dataset mismatch: %s -> %s", prepared.dataset, dataset)
		w.rememberInsertError(err)
		return err
	}
	table := w.tables[dataset]
	if table == nil {
		table = &tableBuffer{}
		w.tables[dataset] = table
	}
	if w.VirtualLedgerTransactions() && dataset == "ledger_transactions" {
		table.nextRow++
		table.routeStats.virtualRows++
		w.totalRows++
		return nil
	}
	metadata, err := w.metadataForRows()
	if err != nil {
		return err
	}
	encoded, err := appendPreparedRow(
		&table.body, body, w.identity, ledgerSequence, table.nextRow, w.ingestedAt, metadata,
	)
	if err != nil {
		if typedNativeEnabled(w.limits, dataset) {
			w.failTypedNative(table, err)
		}
		return fmt.Errorf("encode %s row: %w", dataset, err)
	}
	if typedNativeEnabled(w.limits, dataset) {
		table.nativePrepared = prepared
	}
	return w.finishEncodedRow(ctx, dataset, ledgerSequence, table, encoded)
}

func (w *BatchWriter) validateRowIdentity(dataset string, ledgerSequence uint32) error {
	if _, ok := schema.Lookup(dataset); !ok {
		return fmt.Errorf("unknown Hubble dataset %q", dataset)
	}
	if ledgerSequence < w.identity.StartLedger || ledgerSequence > w.identity.EndLedger {
		return fmt.Errorf("%s ledger %d is outside immutable batch [%d,%d]",
			dataset, ledgerSequence, w.identity.StartLedger, w.identity.EndLedger)
	}
	return nil
}
