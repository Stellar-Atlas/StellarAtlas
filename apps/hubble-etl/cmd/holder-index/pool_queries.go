package main

import "context"

func (i indexer) seedPools(ctx context.Context) error {
	if err := i.checkBudget(ctx); err != nil {
		return err
	}
	if _, err := i.execute(ctx, i.snapshotPoolSQL(""), nil); err != nil {
		return err
	}
	logEvent("pool-index-seeded", true)
	return nil
}

func (i indexer) snapshotPoolSQL(predicate string) string {
	return `INSERT INTO ` + i.database + `._asset_pool_current (pool_id,state)
SELECT liquidity_pool_id AS pool_id,
 max(tuple(ledger_sequence,_row_number,_ingested_at,_batch_id,_source_sha256,
 liquidity_pool_id_strkey,type,fee,trustline_count,pool_share_count,
 asset_a_type,asset_a_code,asset_a_issuer,asset_a_amount,
 asset_b_type,asset_b_code,asset_b_issuer,asset_b_amount,
 deleted,closed_at,last_modified_ledger)) AS state
FROM ` + i.database + `.liquidity_pools
WHERE (_batch_id,_source_sha256) IN (
 SELECT batch_id,tupleElement(argMax(tuple(status,source_sha256),updated_at),2)
 FROM ` + i.database + `._ingestion_batches GROUP BY batch_id
 HAVING tupleElement(argMax(tuple(status,source_sha256),updated_at),1)='complete'
) ` + predicate + `
GROUP BY pool_id
SETTINGS max_threads=2,max_execution_time=600,max_memory_usage=17179869184,max_bytes_before_external_group_by=0,max_local_read_bandwidth=67108864`
}
