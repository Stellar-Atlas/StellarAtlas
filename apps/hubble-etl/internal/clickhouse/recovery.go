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
	if !uuidPattern.MatchString(identity.ID) || !digestPattern.MatchString(identity.SourceSHA256) || identity.StartLedger == 0 || identity.EndLedger < identity.StartLedger {
		return fmt.Errorf("invalid immutable batch identity")
	}
	for _, dataset := range schema.Datasets() {
		want := uint64(0)
		if expected != nil {
			var ok bool
			want, ok = expected[dataset.Name]
			if !ok {
				return fmt.Errorf("missing expected count for %s", dataset.Name)
			}
		}
		query := "SELECT count() AS rows, uniqExact(_row_number) AS distinct_rows," +
			" min(_row_number) AS min_row, max(_row_number) AS max_row," +
			" countIf(_source_sha256 != {digest:String}) AS wrong_source FROM " + quoted(c.database) + "." + quoted(dataset.Name) +
			" PREWHERE " + batchLedgerPredicate(dataset) + " WHERE _batch_id={batch:UUID}" +
			" SETTINGS max_threads=1,max_execution_time=30,max_memory_usage=200000000,output_format_json_quote_64bit_integers=1 FORMAT JSONEachRow"
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
