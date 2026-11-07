package catalog

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/stellar/go-stellar-sdk/network"
)

// Bound batch-only inputs before metadata access. The existing frontier/range
// indexes select one tip and the age band; each lateral lookup is a dataset
// primary-key lookup, never a whole-catalog join before LIMIT.
const agedOutBatchSQL = `
	with tip_batch as materialized (
		select b.id, b.end_ledger as latest
		from full_history_ledger_close_meta_batch b
		where b.network_passphrase_hash = $1
		order by b.end_ledger desc
		limit 1
	), tip as materialized (
		select b.latest, d.batch_id is not null as dataset_present
		from tip_batch b
		left join lateral (
			select d.batch_id
			from full_history_ledger_close_meta_dataset d
			where d.batch_id = b.id and d.network_passphrase_hash = $1
			  and d.dataset = 'ledger-close-meta'
			limit 1
		) d on true
	), aged_batches as materialized (
		select b.id, b.start_ledger, b.end_ledger, b.ledger_count
		from full_history_ledger_close_meta_batch b
		where b.network_passphrase_hash = $1
		  and (select dataset_present from tip)
		  and b.start_ledger > greatest(0, (select latest from tip) - $3::bigint) - 1023
		  and b.start_ledger <= (select latest from tip) - $2::bigint - 63
		  and b.end_ledger > greatest(0, (select latest from tip) - $3::bigint)
		  and b.end_ledger <= (select latest from tip) - $2::bigint
		  and b.ledger_count between 64 and 1024
		order by b.start_ledger, b.id
		limit $4
	)
	select t.latest, t.dataset_present as tip_dataset_present,
	       coalesce(b.id::text, '') as id, coalesce(b.start_ledger, 0) as start_ledger,
	       coalesce(b.end_ledger, 0) as end_ledger, coalesce(b.ledger_count, 0) as ledger_count,
	       coalesce(d.storage_key, '') as storage_key,
	       coalesce(encode(d.output_sha256, 'hex'), '') as digest,
	       b.id is null or d.batch_id is not null as dataset_present
	from tip t
	left join aged_batches b on true
	left join lateral (
		select d.batch_id, d.storage_key, d.output_sha256
		from full_history_ledger_close_meta_dataset d
		where d.batch_id = b.id and d.network_passphrase_hash = $1
		  and d.dataset = 'ledger-close-meta'
		limit 1
	) d on b.id is not null
	order by b.start_ledger, b.id
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
		var tipDatasetPresent, datasetPresent bool
		if err := rows.Scan(&tip, &tipDatasetPresent, &batch.ID, &batch.StartLedger, &batch.EndLedger, &batch.LedgerCount, &batch.StorageKey, &batch.SourceSHA256, &datasetPresent); err != nil {
			return 0, nil, fmt.Errorf("decode aged-out immutable catalog: %w", err)
		}
		if err := validateAgedOutDatasetPresence(tipDatasetPresent, batch.ID, datasetPresent); err != nil {
			return 0, nil, err
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

// Missing required metadata is an invariant failure, not an empty age band.
func validateAgedOutDatasetPresence(tipPresent bool, batchID string, datasetPresent bool) error {
	if !tipPresent {
		return fmt.Errorf("aged-out catalog tip lacks required ledger-close-meta dataset")
	}
	if batchID != "" && !datasetPresent {
		return fmt.Errorf("aged-out catalog batch lacks required ledger-close-meta dataset")
	}
	return nil
}
