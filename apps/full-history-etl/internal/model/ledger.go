package model

// Ledger is the partitionable, typed projection of one LedgerCloseMeta header.
type Ledger struct {
	LedgerSequence                int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	LedgerCloseMetaVersion        int32  `parquet:"name=ledger_close_meta_version, type=INT32"`
	LedgerHash                    string `parquet:"name=ledger_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	PreviousLedgerHash            string `parquet:"name=previous_ledger_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionSetHash            string `parquet:"name=transaction_set_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	TransactionResultSetHash      string `parquet:"name=transaction_result_set_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	BucketListHash                string `parquet:"name=bucket_list_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	ClosedAtUnixMillis            int64  `parquet:"name=closed_at_unix_millis, type=INT64, convertedtype=TIMESTAMP_MILLIS"`
	ProtocolVersion               int64  `parquet:"name=protocol_version, type=INT64, convertedtype=UINT_64"`
	TransactionCount              int64  `parquet:"name=transaction_count, type=INT64, convertedtype=UINT_64"`
	SuccessfulTransactionCount    int64  `parquet:"name=successful_transaction_count, type=INT64, convertedtype=UINT_64"`
	FailedTransactionCount        int64  `parquet:"name=failed_transaction_count, type=INT64, convertedtype=UINT_64"`
	OperationCount                int64  `parquet:"name=operation_count, type=INT64, convertedtype=UINT_64"`
	SuccessfulOperationCount      int64  `parquet:"name=successful_operation_count, type=INT64, convertedtype=UINT_64"`
	TotalCoins                    int64  `parquet:"name=total_coins, type=INT64"`
	FeePool                       int64  `parquet:"name=fee_pool, type=INT64"`
	BaseFee                       int64  `parquet:"name=base_fee, type=INT64, convertedtype=UINT_64"`
	BaseReserve                   int64  `parquet:"name=base_reserve, type=INT64, convertedtype=UINT_64"`
	MaxTransactionSetSize         int64  `parquet:"name=max_transaction_set_size, type=INT64, convertedtype=UINT_64"`
	SorobanFeeWrite1KB            int64  `parquet:"name=soroban_fee_write_1kb, type=INT64"`
	HasSorobanFeeWrite1KB         bool   `parquet:"name=has_soroban_fee_write_1kb, type=BOOLEAN"`
	TotalLiveSorobanStateBytes    int64  `parquet:"name=total_live_soroban_state_bytes, type=INT64, convertedtype=UINT_64"`
	HasTotalLiveSorobanStateBytes bool   `parquet:"name=has_total_live_soroban_state_bytes, type=BOOLEAN"`
	EvictedLedgerKeyCount         int64  `parquet:"name=evicted_ledger_key_count, type=INT64, convertedtype=UINT_64"`
}
