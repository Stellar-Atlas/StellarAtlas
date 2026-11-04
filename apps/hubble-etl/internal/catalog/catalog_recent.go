package catalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/stellar/go-stellar-sdk/network"
)

// LoadRecent loads a bounded newest-first window from the immutable catalog.
func LoadRecent(
	ctx context.Context,
	databaseURL string,
	networkPassphrase string,
	limit int,
) ([]Batch, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("PostgreSQL database URL is required")
	}
	if limit < 1 || limit > 128 {
		return nil, fmt.Errorf("recent batch limit must be between 1 and 128")
	}
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect to immutable batch catalog: %w", err)
	}
	defer connection.Close(context.Background())
	// This public Stellar network ID is the existing catalog partition key, not a credential hash.
	networkID := network.ID(networkPassphrase)
	rows, err := connection.Query(ctx, `
		with recent as materialized (
			select id, start_ledger, end_ledger, ledger_count, network_passphrase_hash
			from full_history_ledger_close_meta_batch
			where network_passphrase_hash = $1
			order by start_ledger desc, id desc
			limit $2
		)
		select batch.id::text,
			batch.start_ledger,
			batch.end_ledger,
			batch.ledger_count,
			dataset.storage_key,
			encode(dataset.output_sha256, 'hex')
		from recent batch
		join full_history_ledger_close_meta_dataset dataset
			on dataset.batch_id = batch.id
			and dataset.network_passphrase_hash = batch.network_passphrase_hash
		where dataset.dataset = 'ledger-close-meta'
		order by batch.start_ledger desc, batch.id desc
	`, networkID[:], limit)
	if err != nil {
		return nil, fmt.Errorf("read recent immutable batch catalog: %w", err)
	}
	defer rows.Close()
	batches := make([]Batch, 0, limit)
	for rows.Next() {
		var item Batch
		if err := rows.Scan(
			&item.ID,
			&item.StartLedger,
			&item.EndLedger,
			&item.LedgerCount,
			&item.StorageKey,
			&item.SourceSHA256,
		); err != nil {
			return nil, fmt.Errorf("decode recent immutable batch catalog: %w", err)
		}
		if item.EndLedger < item.StartLedger ||
			item.LedgerCount != item.EndLedger-item.StartLedger+1 {
			return nil, fmt.Errorf("batch %s has inconsistent ledger bounds", item.ID)
		}
		batches = append(batches, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stream recent immutable batch catalog: %w", err)
	}
	return batches, nil
}
