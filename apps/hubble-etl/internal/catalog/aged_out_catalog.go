package catalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/stellar/go-stellar-sdk/network"
)

// The immutable catalog forbids overlapping ranges per network and has a
// unique (network, start, end) index. Bound that index range before joining
// ledger-close-meta metadata; never take the newest N rows and then age-filter.
const agedOutBatchSQL = `
	with tip as materialized (
		select b.end_ledger as latest
		from full_history_ledger_close_meta_batch b
		join full_history_ledger_close_meta_dataset d
		  on d.batch_id = b.id and d.network_passphrase_hash = b.network_passphrase_hash
		  and d.dataset = 'ledger-close-meta'
		where b.network_passphrase_hash = $1
		order by b.start_ledger desc, b.id desc
		limit 1
	), aged as materialized (
		select b.id, b.start_ledger, b.end_ledger, b.ledger_count, d.storage_key,
		       encode(d.output_sha256, 'hex') as digest
		from tip t
		join full_history_ledger_close_meta_batch b
		  on b.network_passphrase_hash = $1
		  and b.start_ledger > greatest(0, t.latest - $3::bigint) - 1023
		  and b.start_ledger <= t.latest - $2::bigint - 63
		  and b.end_ledger > greatest(0, t.latest - $3::bigint)
		  and b.end_ledger <= t.latest - $2::bigint
		  and b.ledger_count between 64 and 1024
		join full_history_ledger_close_meta_dataset d
		  on d.batch_id = b.id and d.network_passphrase_hash = b.network_passphrase_hash
		  and d.dataset = 'ledger-close-meta'
		order by b.start_ledger, b.id
		limit $4
	)
	select t.latest, coalesce(a.id::text, '') as id, coalesce(a.start_ledger, 0) as start_ledger,
	       coalesce(a.end_ledger, 0) as end_ledger, coalesce(a.ledger_count, 0) as ledger_count,
	       coalesce(a.storage_key, '') as storage_key, coalesce(a.digest, '') as digest
	from tip t left join aged a on true
	order by a.start_ledger, a.id
`

// LoadAgedOut returns the whole eligible age band from a single catalog
// snapshot, with one overflow sentinel. It also returns the tip on an empty band.
func LoadAgedOut(ctx context.Context, databaseURL, networkPassphrase string, currentLag, maximumLag uint32) (uint32, []Batch, error) {
	if databaseURL == "" || currentLag == 0 || maximumLag <= currentLag || maximumLag > 17_280 {
		return 0, nil, fmt.Errorf("invalid aged-out catalog bounds")
	}
	// Nonoverlap and the 64-ledger minimum imply at most this many distinct
	// end ledgers. A sentinel means the catalog violated that contract.
	limit := int((maximumLag - currentLag + 63) / 64)
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return 0, nil, fmt.Errorf("connect to aged-out immutable catalog: %w", err)
	}
	defer connection.Close(ctx)
	// The public Stellar network ID is the existing catalog partition key.
	networkID := network.ID(networkPassphrase)
	rows, err := connection.Query(ctx, agedOutBatchSQL, networkID[:], int64(currentLag), int64(maximumLag), limit+1)
	if err != nil {
		return 0, nil, fmt.Errorf("read aged-out immutable catalog: %w", err)
	}
	defer rows.Close()
	var latest, previousEnd uint32
	batches := make([]Batch, 0, limit)
	for rows.Next() {
		var tip uint32
		var batch Batch
		if err := rows.Scan(&tip, &batch.ID, &batch.StartLedger, &batch.EndLedger, &batch.LedgerCount, &batch.StorageKey, &batch.SourceSHA256); err != nil {
			return 0, nil, fmt.Errorf("decode aged-out immutable catalog: %w", err)
		}
		if tip == 0 || (latest != 0 && latest != tip) {
			return 0, nil, fmt.Errorf("aged-out catalog tip changed in one snapshot")
		}
		latest = tip
		if batch.ID == "" {
			continue
		}
		var minimumEnd uint32
		if latest > maximumLag {
			minimumEnd = latest - maximumLag
		}
		if len(batches) >= limit || batch.StartLedger <= previousEnd || batch.EndLedger < batch.StartLedger ||
			batch.LedgerCount != batch.EndLedger-batch.StartLedger+1 || batch.LedgerCount < 64 || batch.LedgerCount > 1024 ||
			latest <= currentLag || batch.EndLedger > latest-currentLag || batch.EndLedger <= minimumEnd {
			return 0, nil, fmt.Errorf("aged-out catalog violated its immutable age-band bound")
		}
		previousEnd = batch.EndLedger
		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, fmt.Errorf("stream aged-out immutable catalog: %w", err)
	}
	return latest, batches, nil
}
