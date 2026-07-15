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
	ExtensionVersion         int32  `parquet:"name=extension_version, type=INT32"`
	ContractID               string `parquet:"name=contract_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	HasContractID            bool   `parquet:"name=has_contract_id, type=BOOLEAN"`
	EventType                int32  `parquet:"name=event_type, type=INT32"`
	EventTypeString          string `parquet:"name=event_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	BodyVersion              int32  `parquet:"name=body_version, type=INT32"`
	TopicCount               int64  `parquet:"name=topic_count, type=INT64, convertedtype=UINT_64"`
	TopicsXDR                string `parquet:"name=topics_xdr, type=BYTE_ARRAY"`
	DataType                 int32  `parquet:"name=data_type, type=INT32"`
	DataTypeString           string `parquet:"name=data_type_string, type=BYTE_ARRAY, convertedtype=UTF8, encoding=PLAIN_DICTIONARY"`
	DataXDR                  string `parquet:"name=data_xdr, type=BYTE_ARRAY"`
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
	LedgerKeyXDR      string `parquet:"name=ledger_key_xdr, type=BYTE_ARRAY"`
	HasPreEntry       bool   `parquet:"name=has_pre_entry, type=BOOLEAN"`
	PreEntryXDR       string `parquet:"name=pre_entry_xdr, type=BYTE_ARRAY"`
	HasPostEntry      bool   `parquet:"name=has_post_entry, type=BOOLEAN"`
	PostEntryXDR      string `parquet:"name=post_entry_xdr, type=BYTE_ARRAY"`
}
