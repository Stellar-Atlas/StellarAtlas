package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/stellar/stellar-etl/v2/stellaratlas-hubble/internal/clickhouse"
)

type indexer struct {
	client           *clickhouse.Client
	database, policy string
}

func (i indexer) execute(ctx context.Context, sql string, params url.Values) ([]byte, error) {
	return i.client.ExecuteHolderIndexSQL(ctx, sql, params, nil)
}

func (i indexer) initialize(ctx context.Context) error {
	if !validName(i.database) || !validName(i.policy) {
		return fmt.Errorf("invalid index configuration")
	}
	_, err := i.execute(ctx, `CREATE TABLE IF NOT EXISTS `+i.database+`._asset_holder_index_assets (asset_key String,status String,updated_at DateTime64(6,'UTC'),error String) ENGINE=ReplacingMergeTree(updated_at) ORDER BY asset_key SETTINGS storage_policy='`+i.policy+`'`, nil)
	return err
}

func (i indexer) mark(ctx context.Context, key, status string) error {
	_, err := i.execute(ctx, `INSERT INTO `+i.database+`._asset_holder_index_assets SELECT {asset:String},{status:String},now64(6),''`, url.Values{"param_asset": {key}, "param_status": {status}})
	return err
}

func (i indexer) seed(ctx context.Context, asset string) error {
	table := "trustlines"
	params := url.Values{}
	predicate := ""
	if asset == "native" {
		table = "accounts"
	} else {
		code, issuer, ok := strings.Cut(asset, ":")
		if !ok || len(code) < 1 || len(code) > 12 || len(issuer) != 56 || !strings.HasPrefix(issuer, "G") {
			return fmt.Errorf("exact classic asset or native required")
		}
		params.Set("param_code", code)
		params.Set("param_issuer", issuer)
		predicate = " AND asset_code={code:String} AND asset_issuer={issuer:String}"
	}
	if err := i.mark(ctx, asset, "building"); err != nil {
		return err
	}
	if _, err := i.execute(ctx, i.snapshotSQL(table, predicate), params); err != nil {
		return err
	}
	if err := i.mark(ctx, asset, "ready"); err != nil {
		return err
	}
	logEvent("asset-index-ready", asset)
	return nil
}

func (i indexer) backfill(ctx context.Context) error {
	if err := i.mark(ctx, "*", "building"); err != nil {
		return err
	}
	for _, table := range []string{"trustlines", "accounts"} {
		body, err := i.execute(ctx, `SELECT DISTINCT partition FROM system.parts WHERE database={db:String} AND table={table:String} AND active ORDER BY toUInt64(partition) DESC FORMAT JSON`, url.Values{"param_db": {i.database}, "param_table": {table}})
		if err != nil {
			return err
		}
		var parts struct {
			Data []struct {
				Partition string `json:"partition"`
			} `json:"data"`
		}
		if err = json.Unmarshal(body, &parts); err != nil {
			return err
		}
		for _, part := range parts.Data {
			if err := i.checkBudget(ctx); err != nil {
				return err
			}
			value, err := strconv.ParseUint(part.Partition, 10, 32)
			if err != nil {
				return err
			}
			key := "partition:" + table + ":" + part.Partition
			body, err = i.execute(ctx, `SELECT status FROM `+i.database+`._asset_holder_index_assets FINAL WHERE asset_key={key:String} FORMAT JSON`, url.Values{"param_key": {key}})
			if err != nil {
				return err
			}
			var states struct {
				Data []struct {
					Status string `json:"status"`
				} `json:"data"`
			}
			if err = json.Unmarshal(body, &states); err != nil {
				return err
			}
			if len(states.Data) > 0 && states.Data[0].Status == "ready" {
				continue
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err = i.mark(ctx, key, "building"); err != nil {
				return err
			}
			if _, err = i.execute(ctx, i.snapshotSQL(table, " AND intDiv(_ledger_sequence,1048576)={part:UInt32}"), url.Values{"param_part": {strconv.FormatUint(value, 10)}}); err != nil {
				return err
			}
			if err = i.mark(ctx, key, "ready"); err != nil {
				return err
			}
			logEvent("holder-partition-indexed", key)
		}
	}
	if err := i.recover(ctx); err != nil {
		return err
	}
	if err := i.mark(ctx, "*", "ready"); err != nil {
		return err
	}
	logEvent("holder-backfill-ready", true)
	return nil
}

func (i indexer) snapshotSQL(table, predicate string) string {
	asset, limit, domain := "concat(asset_code,':',asset_issuer)", "trust_line_limit", "''"
	if table == "accounts" {
		asset, limit, domain = "'native'", "toInt64(0)", "home_domain"
	} else {
		predicate += " AND asset_type IN ('credit_alphanum4','credit_alphanum12')"
	}
	return `INSERT INTO ` + i.database + `._asset_holder_current
	 SELECT ` + asset + ` AS asset_key,account_id,
	 max(tuple(ledger_sequence,_row_number,_ingested_at,balance,buying_liabilities,selling_liabilities,` + limit + `,flags,deleted,last_modified_ledger,` + domain + `,_batch_id,_source_sha256,ifNull(sponsor,''),closed_at)) AS state
	 FROM ` + i.database + `.` + table + `
	 WHERE (_batch_id,_source_sha256) IN (SELECT batch_id,tupleElement(argMax(tuple(status,source_sha256),updated_at),2) FROM ` + i.database + `._ingestion_batches GROUP BY batch_id HAVING tupleElement(argMax(tuple(status,source_sha256),updated_at),1)='complete') ` + predicate + `
	 GROUP BY asset_key,account_id
	 SETTINGS max_threads=2,max_execution_time=600,max_memory_usage=17179869184,max_bytes_before_external_group_by=0,max_local_read_bandwidth=67108864`
}

func (i indexer) promote(ctx context.Context) error {
	rows, err := i.execute(ctx, `SELECT batch_id,source_sha256,toString(row_count) AS row_count,start_ledger,end_ledger FROM `+i.database+`._asset_holder_index_batches FINAL WHERE status='staged' AND (batch_id,source_sha256) IN (SELECT batch_id,tupleElement(argMax(tuple(status,source_sha256),updated_at),2) FROM `+i.database+`._ingestion_batches GROUP BY batch_id HAVING tupleElement(argMax(tuple(status,source_sha256),updated_at),1)='complete') LIMIT 100 FORMAT JSON`, nil)
	if err != nil {
		return err
	}
	var result struct {
		Data []struct {
			ID    string `json:"batch_id"`
			SHA   string `json:"source_sha256"`
			Rows  string `json:"row_count"`
			Start uint32 `json:"start_ledger"`
			End   uint32 `json:"end_ledger"`
		} `json:"data"`
	}
	if err = json.Unmarshal(rows, &result); err != nil {
		return err
	}
	for _, row := range result.Data {
		count, err := strconv.ParseUint(row.Rows, 10, 64)
		if err != nil {
			return err
		}
		if err = i.client.PromoteHolderIndex(ctx, clickhouse.BatchIdentity{ID: row.ID, SourceSHA256: row.SHA, StartLedger: row.Start, EndLedger: row.End}, count); err != nil {
			return err
		}
	}
	return nil
}

func (i indexer) checkBudget(ctx context.Context) error {
	body, err := i.execute(ctx, `SELECT toString(sum(bytes_on_disk)) AS bytes FROM system.parts WHERE active AND database={db:String} AND (startsWith(table,'_asset_holder_') OR startsWith(table,'_asset_pool_')) FORMAT JSON`, url.Values{"param_db": {i.database}})
	if err != nil {
		return err
	}
	var result struct {
		Data []struct {
			Bytes string `json:"bytes"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &result); err != nil {
		return err
	}
	if len(result.Data) != 1 {
		return fmt.Errorf("index size unavailable")
	}
	size, err := strconv.ParseUint(result.Data[0].Bytes, 10, 64)
	if err != nil {
		return err
	}
	if size >= 32<<30 {
		return fmt.Errorf("read-model rebuild paused: 32 GiB budget reached")
	}
	return nil
}
