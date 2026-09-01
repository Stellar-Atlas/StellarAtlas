package catalog

import (
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type Batch struct {
	ID           string
	StartLedger  uint32
	EndLedger    uint32
	LedgerCount  uint32
	StorageKey   string
	SourceSHA256 string
}

func Load(
	ctx context.Context,
	databaseURL string,
	networkPassphrase string,
) ([]Batch, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("PostgreSQL database URL is required")
	}
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect to immutable batch catalog: %w", err)
	}
	defer connection.Close(context.Background())
	networkHash := sha256.Sum256([]byte(networkPassphrase))
	rows, err := connection.Query(ctx, `
		select batch.id::text,
			batch.start_ledger,
			batch.end_ledger,
			batch.ledger_count,
			dataset.storage_key,
			encode(dataset.output_sha256, 'hex')
		from full_history_ledger_close_meta_batch batch
		join full_history_ledger_close_meta_dataset dataset
			on dataset.batch_id = batch.id
			and dataset.network_passphrase_hash = batch.network_passphrase_hash
		where batch.network_passphrase_hash = $1
			and dataset.dataset = 'ledger-close-meta'
		order by batch.start_ledger, batch.id
	`, networkHash[:])
	if err != nil {
		return nil, fmt.Errorf("read immutable batch catalog: %w", err)
	}
	defer rows.Close()
	batches := make([]Batch, 0, 4096)
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
			return nil, fmt.Errorf("decode immutable batch catalog: %w", err)
		}
		if item.EndLedger < item.StartLedger ||
			item.LedgerCount != item.EndLedger-item.StartLedger+1 {
			return nil, fmt.Errorf("batch %s has inconsistent ledger bounds", item.ID)
		}
		batches = append(batches, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stream immutable batch catalog: %w", err)
	}
	return batches, nil
}
