package model

// ContractEvent unifies transaction, operation, and diagnostic event scopes.
type ContractEvent struct {
	LedgerSequence           int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex         int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	EventIndex               int64  `parquet:"name=event_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash          string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	Scope                    string `parquet:"name=scope, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	OperationIndex           int64  `parquet:"name=operation_index, type=INT64, convertedtype=UINT_64"`
	HasOperationIndex        bool   `parquet:"name=has_operation_index, type=BOOLEAN"`
	Stage                    int32  `parquet:"name=stage, type=INT32"`
	StageString              string `parquet:"name=stage_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	HasStage                 bool   `parquet:"name=has_stage, type=BOOLEAN"`
	InSuccessfulContractCall bool   `parquet:"name=in_successful_contract_call, type=BOOLEAN"`
	ContractID               string `parquet:"name=contract_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	EventType                int32  `parquet:"name=event_type, type=INT32"`
	EventTypeString          string `parquet:"name=event_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
}

// LedgerEntryChange is the SDK-normalized pre/post form of an XDR change pair.
type LedgerEntryChange struct {
	LedgerSequence    int64  `parquet:"name=ledger_sequence, type=INT64, convertedtype=UINT_64"`
	TransactionIndex  int64  `parquet:"name=transaction_index, type=INT64, convertedtype=UINT_64"`
	ChangeIndex       int64  `parquet:"name=change_index, type=INT64, convertedtype=UINT_64"`
	TransactionHash   string `parquet:"name=transaction_hash, type=BYTE_ARRAY, convertedtype=UTF8"`
	Reason            string `parquet:"name=reason, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	OperationIndex    int64  `parquet:"name=operation_index, type=INT64, convertedtype=UINT_64"`
	HasOperationIndex bool   `parquet:"name=has_operation_index, type=BOOLEAN"`
	UpgradeIndex      int64  `parquet:"name=upgrade_index, type=INT64, convertedtype=UINT_64"`
	HasUpgradeIndex   bool   `parquet:"name=has_upgrade_index, type=BOOLEAN"`
	EntryType         int32  `parquet:"name=entry_type, type=INT32"`
	EntryTypeString   string `parquet:"name=entry_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	ChangeType        int32  `parquet:"name=change_type, type=INT32"`
	ChangeTypeString  string `parquet:"name=change_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	LedgerKeySHA256   string `parquet:"name=ledger_key_sha256, type=BYTE_ARRAY, convertedtype=UTF8"`
}
