package model

// Transaction contains stable lookup fields derived from canonical close meta.
type Transaction struct {
	LedgerSequence     int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex   int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash    string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	EnvelopeType       int32  `parquet:"name=envelope_type, type=INT32"`
	EnvelopeTypeString string `parquet:"name=envelope_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	SourceAccount      string `parquet:"name=source_account, type=BYTE_ARRAY, convertedtype=UTF8"`
	SourceAccountMuxed string `parquet:"name=source_account_muxed, type=BYTE_ARRAY, convertedtype=UTF8"`
	FeeAccount         string `parquet:"name=fee_account, type=BYTE_ARRAY, convertedtype=UTF8"`
	FeeAccountMuxed    string `parquet:"name=fee_account_muxed, type=BYTE_ARRAY, convertedtype=UTF8"`
	AccountSequence    int64  `parquet:"name=account_sequence, type=INT64"`
	MaxFee             int64  `parquet:"name=max_fee, type=INT64, convertedtype=UINT_64"`
	FeeBumpMaxFee      int64  `parquet:"name=fee_bump_max_fee, type=INT64"`
	IsFeeBump          bool   `parquet:"name=is_fee_bump, type=BOOLEAN"`
	OperationCount     int64  `parquet:"name=operation_count, type=INT64, convertedtype=UINT_64"`
	MemoType           string `parquet:"name=memo_type, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	Memo               string `parquet:"name=memo, type=BYTE_ARRAY, convertedtype=UTF8"`
	SignatureCount     int64  `parquet:"name=signature_count, type=INT64, convertedtype=UINT_64"`
	Successful         bool   `parquet:"name=successful, type=BOOLEAN"`
	ClosedAtUnixMillis int64  `parquet:"name=closed_at_unix_millis, type=INT64, convertedtype=TIMESTAMP_MILLIS"`
}

// TransactionResult separates result facts from the transaction envelope.
type TransactionResult struct {
	LedgerSequence       int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex     int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash      string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	Successful           bool   `parquet:"name=successful, type=BOOLEAN"`
	FeeCharged           int64  `parquet:"name=fee_charged, type=INT64"`
	ResultCode           int32  `parquet:"name=result_code, type=INT32"`
	ResultCodeString     string `parquet:"name=result_code_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	OperationResultCount int64  `parquet:"name=operation_result_count, type=INT64, convertedtype=UINT_64"`
	InnerTransactionHash string `parquet:"name=inner_transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
}

// TransactionMeta carries typed cardinalities derived from transaction metadata.
type TransactionMeta struct {
	LedgerSequence          int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex        int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash         string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	MetaVersion             int32  `parquet:"name=meta_version, type=INT32"`
	OperationMetaCount      int64  `parquet:"name=operation_meta_count, type=INT64, convertedtype=UINT_64"`
	FeeChangeCount          int64  `parquet:"name=fee_change_count, type=INT64, convertedtype=UINT_64"`
	TransactionChangeCount  int64  `parquet:"name=transaction_change_count, type=INT64, convertedtype=UINT_64"`
	PostApplyFeeChangeCount int64  `parquet:"name=post_apply_fee_change_count, type=INT64, convertedtype=UINT_64"`
	TransactionEventCount   int64  `parquet:"name=transaction_event_count, type=INT64, convertedtype=UINT_64"`
	OperationEventCount     int64  `parquet:"name=operation_event_count, type=INT64, convertedtype=UINT_64"`
	DiagnosticEventCount    int64  `parquet:"name=diagnostic_event_count, type=INT64, convertedtype=UINT_64"`
	IsSoroban               bool   `parquet:"name=is_soroban, type=BOOLEAN"`
}

// Operation contains stable lookup fields. Detailed operation projections are
// added by type-specific transforms instead of retaining duplicate opaque XDR.
type Operation struct {
	LedgerSequence        int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex      int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	OperationIndex        int64  `parquet:"name=operation_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash       string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	SourceAccount         string `parquet:"name=source_account, type=BYTE_ARRAY, convertedtype=UTF8"`
	SourceAccountMuxed    string `parquet:"name=source_account_muxed, type=BYTE_ARRAY, convertedtype=UTF8"`
	OperationType         int32  `parquet:"name=operation_type, type=INT32"`
	OperationTypeString   string `parquet:"name=operation_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	ResultCode            int32  `parquet:"name=result_code, type=INT32"`
	ResultCodeString      string `parquet:"name=result_code_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	HasResult             bool   `parquet:"name=has_result, type=BOOLEAN"`
	SuccessfulTransaction bool   `parquet:"name=successful_transaction, type=BOOLEAN"`
}
