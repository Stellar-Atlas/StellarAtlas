#!/usr/bin/env bash
set -euo pipefail

# Materialize the two report indexes for exactly one active history_trades
# partition. Call once per partition, latest first; each ALTER waits for
# completion before the next begins. No whole-table materialization is done.
partition=${1:?Usage: materialize-history-trade-asset-indexes.sh PARTITION_ID}
[[ "$partition" =~ ^[0-9]+$ ]] || {
	echo 'partition id must be numeric' >&2
	exit 2
}

probe=${HOLDER_INDEX_SQL_PROBE:-/mnt/fast/stellaratlas/bin/holder-index-20261013-sql-probe}
backend_env=${BACKEND_ENV_FILE:-/mnt/bulk/stellarbeat-data/Observer/apps/backend/.env}
etl_env=${ETL_ENV_FILE:-/etc/stellaratlas/hubble-etl.env}
database=${HUBBLE_DATABASE:-stellar_hubble_v2}
budget_bytes=${MAX_INDEX_BYTES:-134217728}

run_sql() {
	printf '%s\n' "$1" | sudo systemd-run --quiet --wait --pipe --collect \
		-pUser=admins \
		-pEnvironmentFile="$backend_env" \
		-pEnvironmentFile="$etl_env" \
		-pNice=19 \
		-pIOWeight=10 \
		"$probe" sql
}

active_parts=$(run_sql "SELECT count() FROM system.parts WHERE database='${database}' AND table='history_trades' AND active AND partition='${partition}' FORMAT TSV")
[[ "$active_parts" =~ ^[0-9]+$ && "$active_parts" -gt 0 ]] || {
	echo "partition ${partition} has no active history_trades parts" >&2
	exit 2
}

for index in idx_report_selling_asset_pair idx_report_buying_asset_pair; do
	echo "materializing ${index} in history_trades partition ${partition}"
	run_sql "ALTER TABLE ${database}.history_trades MATERIALIZE INDEX ${index} IN PARTITION ${partition} SETTINGS max_threads=2, max_memory_usage=4294967296, mutations_sync=1" >/dev/null
	index_bytes=$(run_sql "SELECT sum(data_compressed_bytes) FROM system.data_skipping_indices WHERE database='${database}' AND table='history_trades' AND name IN ('idx_report_selling_asset_pair','idx_report_buying_asset_pair') FORMAT TSV")
	[[ "$index_bytes" =~ ^[0-9]+$ ]] || {
		echo 'could not read compressed index byte total' >&2
		exit 3
	}
	echo "compressed_index_bytes=${index_bytes}"
	if (( index_bytes > budget_bytes )); then
		echo "compressed index budget exceeded (${index_bytes} > ${budget_bytes}); stopping" >&2
		exit 4
	fi
done

echo "partition ${partition} complete; active_parts=${active_parts}"
