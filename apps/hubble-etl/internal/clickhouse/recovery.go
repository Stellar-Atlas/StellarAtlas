package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/schema"
)

type batchRowStats struct {
	Rows        uint64 `json:"rows,string"`
	Distinct    uint64 `json:"distinct_rows,string"`
	Minimum     uint64 `json:"min_row,string"`
	Maximum     uint64 `json:"max_row,string"`
	WrongSource uint64 `json:"wrong_source,string"`
}

// VerifyBatchRows performs only narrow metadata-column reads in the immutable
// ledger bounds. nil expected is the fail-closed, zero-surviving-rows preflight.
// An INSERT acknowledgement is not proof of rows: orphan dedup records can ACK
// missing data, so this gate must run before publishing recovery completion.
func (c *Client) VerifyBatchRows(ctx context.Context, identity BatchIdentity, expected map[string]uint64) error {
	return c.verifyBatchRows(ctx, identity, expected, schema.Datasets(), 30)
}

// Both canonical projections have a leading ledger primary key. Keep ordinary
// publication checks bounded to these two sources rather than scanning every
// asset/account-ordered dataset in a million-ledger partition per new batch.
func (c *Client) VerifyCanonicalTransactionRows(ctx context.Context, identity BatchIdentity, expected map[string]uint64) error {
	transactions, _ := schema.Lookup("history_transactions")
	ledgers, _ := schema.Lookup("history_ledgers")
	// A narrow publication read can encounter a cold or congested storage path.
	// Keep its identity checks intact without applying the recovery-scan deadline.
	return c.verifyBatchRows(ctx, identity, expected, []schema.Dataset{transactions, ledgers}, 120)
}

func (c *Client) verifyBatchRows(ctx context.Context, identity BatchIdentity, expected map[string]uint64, datasets []schema.Dataset, maximumSeconds int) error {
	if !uuidPattern.MatchString(identity.ID) || !digestPattern.MatchString(identity.SourceSHA256) || identity.StartLedger == 0 || identity.EndLedger < identity.StartLedger {
		return fmt.Errorf("invalid immutable batch identity")
	}
	for _, dataset := range datasets {
		want := uint64(0)
		if expected != nil {
			var ok bool
			want, ok = expected[dataset.Name]
			if !ok {
				return fmt.Errorf("missing expected count for %s", dataset.Name)
			}
		}
		physicalDataset := dataset
		if c.virtualLedgerTransactions && dataset.Name == "ledger_transactions" {
			physicalDataset, _ = schema.Lookup("history_transactions")
		}
		query := "SELECT count() AS rows, uniqExact(_row_number) AS distinct_rows," +
			" min(_row_number) AS min_row, max(_row_number) AS max_row," +
			" countIf(_source_sha256 != {digest:String}) AS wrong_source FROM " + quoted(c.database) + "." + quoted(physicalDataset.Name) +
			" PREWHERE " + batchLedgerPredicate(physicalDataset) + " WHERE _batch_id={batch:UUID}" +
			" SETTINGS max_threads=1,max_execution_time=" + strconv.Itoa(maximumSeconds) + ",max_memory_usage=200000000,output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow"
		body, err := c.execute(ctx, query, url.Values{
			"param_batch": {identity.ID}, "param_digest": {identity.SourceSHA256},
			"param_start": {strconv.FormatUint(uint64(identity.StartLedger), 10)}, "param_end": {strconv.FormatUint(uint64(identity.EndLedger), 10)},
		}, nil)
		if err != nil {
			return fmt.Errorf("verify %s: %w", dataset.Name, err)
		}
		var stats batchRowStats
		if err := json.Unmarshal(body, &stats); err != nil {
			return fmt.Errorf("decode %s verification: %w", dataset.Name, err)
		}
		if err := validateBatchRowStats(stats, want); err != nil {
			return fmt.Errorf("%s: %w", dataset.Name, err)
		}
	}
	return nil
}

// Keep the physical partition bound and the dataset's actual ledger key. The
// metadata ledger column alone cannot prune ledger-sequence primary indexes.
func batchLedgerPredicate(dataset schema.Dataset) string {
	predicate := "_ledger_sequence BETWEEN {start:UInt32} AND {end:UInt32}"
	for _, column := range dataset.OrderBy {
		if column == "ledger_sequence" || column == "sequence" {
			return predicate + " AND " + quoted(column) + " BETWEEN {start:UInt32} AND {end:UInt32}"
		}
	}
	return predicate
}

func validateBatchRowStats(stats batchRowStats, expected uint64) error {
	if stats.Rows != expected || stats.Distinct != expected || stats.WrongSource != 0 || (expected > 0 && (stats.Minimum != 0 || stats.Maximum != expected-1)) {
		return fmt.Errorf("expected %d rows numbered 0..N-1 from source; got %+v", expected, stats)
	}
	return nil
}
